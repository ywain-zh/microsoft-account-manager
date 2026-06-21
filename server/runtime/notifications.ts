import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { fetch, ProxyAgent, type Dispatcher, type RequestInit as UndiciRequestInit } from 'undici';

export interface TelegramNotificationConfig {
  enabled: boolean;
  botToken?: string;
  botTokenConfigured?: boolean;
  clearBotToken?: boolean;
  chatId: string;
  useSystemProxy: boolean;
}

export interface NotificationConfig {
  telegram: TelegramNotificationConfig;
}

export interface NotificationTestResult {
  ok: boolean;
  message: string;
}

export type PublicCheckinNotificationStatus = 'success' | 'failed' | 'skipped';

export interface PublicCheckinNotificationItem {
  accountId: number;
  label?: string | null;
  siteName?: string | null;
  result?: {
    success?: boolean;
    status?: PublicCheckinNotificationStatus;
    reward?: number | null;
    rewardNote?: string | null;
    errorMessage?: string | null;
  };
}

interface StoredTelegramNotificationConfig {
  enabled: boolean;
  botTokenEncrypted: string;
  chatId: string;
  useSystemProxy: boolean;
}

interface StoredNotificationConfig {
  telegram: StoredTelegramNotificationConfig;
}

const NOTIFICATION_CONFIG_KEY = 'notification_config';
const SYSTEM_PROXY_CONFIG_KEY = 'system_proxy_config';
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_MESSAGE_LIMIT = 3900;

const DEFAULT_STORED_NOTIFICATION_CONFIG: StoredNotificationConfig = {
  telegram: {
    enabled: false,
    botTokenEncrypted: '',
    chatId: '',
    useSystemProxy: true
  }
};

const proxyAgentCache = new Map<string, ProxyAgent>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

async function dbFirst<T>(db: D1Database, query: string, values: unknown[] = []): Promise<T | null> {
  return db.prepare(query).bind(...values).first<T>();
}

async function dbRun(db: D1Database, query: string, values: unknown[] = []): Promise<D1Result> {
  return db.prepare(query).bind(...values).run();
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

async function getAppSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await dbFirst<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = ? LIMIT 1', [key]);
  return row?.value ?? null;
}

async function setAppSetting(db: D1Database, key: string, value: string): Promise<void> {
  await dbRun(db, `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `, [key, value]);
}

function notificationKeyPath(): string {
  const explicitDir = process.env.NOTIFICATION_DATA_DIR?.trim()
    || process.env.PUBLIC_CHECKIN_DATA_DIR?.trim()
    || process.env.DATA_DIR?.trim();
  const dataDir = explicitDir || path.dirname(path.resolve(process.env.DB_PATH || 'data/account-manager.db'));
  return path.resolve(dataDir, 'notification-encryption.key');
}

function normalizeHexKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  return Buffer.from(trimmed, 'hex');
}

function resolveEncryptionKey(): Buffer {
  const envKey = process.env.NOTIFICATION_ENCRYPTION_KEY || process.env.PUBLIC_CHECKIN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
  if (envKey.trim()) {
    const parsed = normalizeHexKey(envKey);
    if (!parsed) throw new Error('NOTIFICATION_ENCRYPTION_KEY 必须是 32 字节 hex 字符串（64 位十六进制）');
    return parsed;
  }

  const filePath = notificationKeyPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const parsed = normalizeHexKey(readFileSync(filePath, 'utf8'));
    if (!parsed) throw new Error(`${filePath} 中的通知加密密钥格式无效`);
    return parsed;
  }

  const generated = randomBytes(32);
  writeFileSync(filePath, generated.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return generated;
}

function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ciphertext, tag].map((part) => part.toString('base64')).join(':');
}

function decryptSecret(ciphertext: string): string {
  const [ivRaw, encryptedRaw, tagRaw] = ciphertext.split(':');
  if (!ivRaw || !encryptedRaw || !tagRaw) {
    throw new Error('通知密文格式无效');
  }
  const decipher = createDecipheriv('aes-256-gcm', resolveEncryptionKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function normalizeStoredNotificationConfig(input: unknown): StoredNotificationConfig {
  const record = asRecord(input);
  const telegram = asRecord(record.telegram);
  return {
    telegram: {
      enabled: asBoolean(telegram.enabled, DEFAULT_STORED_NOTIFICATION_CONFIG.telegram.enabled),
      botTokenEncrypted: asString(telegram.botTokenEncrypted).trim(),
      chatId: asString(telegram.chatId).trim(),
      useSystemProxy: asBoolean(telegram.useSystemProxy, DEFAULT_STORED_NOTIFICATION_CONFIG.telegram.useSystemProxy)
    }
  };
}

function toPublicNotificationConfig(config: StoredNotificationConfig): NotificationConfig {
  let botToken = '';
  if (config.telegram.botTokenEncrypted) {
    try {
      botToken = decryptSecret(config.telegram.botTokenEncrypted);
    } catch {
      botToken = '';
    }
  }

  return {
    telegram: {
      enabled: config.telegram.enabled,
      botToken,
      botTokenConfigured: Boolean(config.telegram.botTokenEncrypted),
      clearBotToken: false,
      chatId: config.telegram.chatId,
      useSystemProxy: config.telegram.useSystemProxy
    }
  };
}

function validateTelegramBotToken(token: string): void {
  if (!token) return;
  if (token.length > 256) {
    throw new HTTPException(400, { message: 'Telegram Bot Token 长度不能超过 256 个字符' });
  }
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new HTTPException(400, { message: 'Telegram Bot Token 格式不合法' });
  }
}

function validateTelegramChatId(chatId: string): void {
  if (!chatId) return;
  if (chatId.length > 128) {
    throw new HTTPException(400, { message: 'Telegram Chat ID 长度不能超过 128 个字符' });
  }
  if (/\s/.test(chatId)) {
    throw new HTTPException(400, { message: 'Telegram Chat ID 不能包含空白字符' });
  }
}

function validateStoredNotificationConfig(config: StoredNotificationConfig): void {
  validateTelegramChatId(config.telegram.chatId);
  if (!config.telegram.enabled) return;
  if (!config.telegram.botTokenEncrypted) {
    throw new HTTPException(400, { message: '请填写 Telegram Bot Token' });
  }
  if (!config.telegram.chatId) {
    throw new HTTPException(400, { message: '请填写 Telegram Chat ID' });
  }
}

function mergeNotificationConfig(input: unknown, current: StoredNotificationConfig): StoredNotificationConfig {
  const record = asRecord(input);
  const telegram = asRecord(record.telegram);
  const botToken = asString(telegram.botToken).trim();
  let botTokenEncrypted = current.telegram.botTokenEncrypted;
  if (asBoolean(telegram.clearBotToken, false)) {
    botTokenEncrypted = '';
  }
  if (botToken) {
    validateTelegramBotToken(botToken);
    botTokenEncrypted = encryptSecret(botToken);
  }

  const next: StoredNotificationConfig = {
    telegram: {
      enabled: asBoolean(telegram.enabled, current.telegram.enabled),
      botTokenEncrypted,
      chatId: asString(telegram.chatId).trim(),
      useSystemProxy: asBoolean(telegram.useSystemProxy, current.telegram.useSystemProxy)
    }
  };
  validateStoredNotificationConfig(next);
  return next;
}

async function getStoredNotificationConfig(db: D1Database): Promise<StoredNotificationConfig> {
  const value = await getAppSetting(db, NOTIFICATION_CONFIG_KEY);
  if (!value) return DEFAULT_STORED_NOTIFICATION_CONFIG;

  try {
    return normalizeStoredNotificationConfig(JSON.parse(value) as unknown);
  } catch {
    return DEFAULT_STORED_NOTIFICATION_CONFIG;
  }
}

export async function getNotificationConfig(db: D1Database): Promise<NotificationConfig> {
  return toPublicNotificationConfig(await getStoredNotificationConfig(db));
}

export async function updateNotificationConfig(db: D1Database, body: unknown): Promise<NotificationConfig> {
  const next = mergeNotificationConfig(body, await getStoredNotificationConfig(db));
  await setAppSetting(db, NOTIFICATION_CONFIG_KEY, JSON.stringify(next));
  return toPublicNotificationConfig(next);
}

async function getSystemProxyUrl(db: D1Database): Promise<string> {
  const value = await getAppSetting(db, SYSTEM_PROXY_CONFIG_KEY);
  if (!value) return '';
  try {
    const parsed = asRecord(JSON.parse(value) as unknown);
    return asString(parsed.proxyUrl).trim();
  } catch {
    return '';
  }
}

function getProxyDispatcher(proxyUrl: string): Dispatcher | undefined {
  const resolved = proxyUrl.trim();
  if (!resolved) return undefined;
  const parsed = new URL(resolved);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Telegram 通知代理当前支持 http:// 或 https:// 代理地址');
  }
  let agent = proxyAgentCache.get(resolved);
  if (!agent) {
    agent = new ProxyAgent(resolved);
    proxyAgentCache.set(resolved, agent);
  }
  return agent;
}

function parseTelegramError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { description?: unknown; error_code?: unknown };
    const description = asString(parsed.description).trim();
    if (description) return description;
    const errorCode = asString(parsed.error_code).trim();
    if (errorCode) return `Telegram API 错误 ${errorCode}`;
  } catch {}
  return text.trim().slice(0, 200) || 'Telegram API 返回错误';
}

async function deliverTelegramMessage(input: {
  botToken: string;
  chatId: string;
  text: string;
  proxyUrl: string;
}): Promise<NotificationTestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${input.botToken}/sendMessage`, {
      method: 'POST',
      dispatcher: getProxyDispatcher(input.proxyUrl),
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Wangyue-Notification/1.0'
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: limitTelegramText(input.text),
        disable_web_page_preview: true
      })
    } satisfies UndiciRequestInit);
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        message: `Telegram API 返回错误：${parseTelegramError(text)}`
      };
    }
    return { ok: true, message: '测试通知已发送' };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Telegram 请求超时'
      : error instanceof Error
        ? error.message
        : 'Telegram 通知发送失败';
    return { ok: false, message };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveTelegramDeliveryInput(db: D1Database): Promise<{
  ok: true;
  botToken: string;
  chatId: string;
  proxyUrl: string;
} | { ok: false; message: string }> {
  const config = await getStoredNotificationConfig(db);
  if (!config.telegram.enabled) {
    return { ok: false, message: 'Telegram 通知未启用' };
  }
  if (!config.telegram.botTokenEncrypted) {
    return { ok: false, message: '缺少 Telegram Bot Token' };
  }
  if (!config.telegram.chatId) {
    return { ok: false, message: '缺少 Telegram Chat ID' };
  }

  let botToken: string;
  try {
    botToken = decryptSecret(config.telegram.botTokenEncrypted);
  } catch {
    return { ok: false, message: 'Telegram Bot Token 解密失败，请重新保存通知配置' };
  }

  return {
    ok: true,
    botToken,
    chatId: config.telegram.chatId,
    proxyUrl: config.telegram.useSystemProxy ? await getSystemProxyUrl(db) : ''
  };
}

async function sendConfiguredTelegramMessage(db: D1Database, text: string): Promise<NotificationTestResult> {
  const delivery = await resolveTelegramDeliveryInput(db);
  if (!delivery.ok) return delivery;
  return deliverTelegramMessage({
    botToken: delivery.botToken,
    chatId: delivery.chatId,
    proxyUrl: delivery.proxyUrl,
    text
  });
}

export async function sendTelegramTestNotification(db: D1Database): Promise<NotificationTestResult> {
  const result = await sendConfiguredTelegramMessage(db, [
    '望月工具箱测试通知',
    `时间：${formatDateTime(new Date())}`,
    'Telegram 通知配置可用。'
  ].join('\n'));
  return result.ok ? { ok: true, message: '测试通知已发送' } : result;
}

function notificationAccountLabel(item: PublicCheckinNotificationItem): string {
  const siteName = asString(item.siteName).trim();
  const label = asString(item.label).trim();
  if (siteName && label && siteName !== label) return `${siteName} / ${label}`;
  return siteName || label || `账号 ${item.accountId}`;
}

function formatReward(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('zh-CN', { hour12: false });
}

function truncateLine(value: string, maxLength = 180): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function limitTelegramText(value: string, maxLength = TELEGRAM_MESSAGE_LIMIT): string {
  if (value.length <= maxLength) return value;
  const suffix = '\n...内容过长，已截断';
  return `${value.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}

export function buildPublicCheckinSummaryMessage(items: PublicCheckinNotificationItem[], now = new Date()): string {
  const successItems = items.filter((item) => item.result?.status === 'success' && item.result.success !== false);
  const failedItems = items.filter((item) => item.result?.status === 'failed' || item.result?.success === false);
  const skippedItems = items.filter((item) => item.result?.status === 'skipped');
  const rewardTotal = successItems.reduce((sum, item) => {
    const reward = item.result?.reward;
    return typeof reward === 'number' && Number.isFinite(reward) ? sum + reward : sum;
  }, 0);

  const lines = [
    '公益站每日签到汇总',
    `时间：${formatDateTime(now)}`,
    `总数：${items.length}`,
    `成功：${successItems.length}`,
    `失败：${failedItems.length}`,
    `跳过：${skippedItems.length}`,
    `奖励合计：${formatReward(rewardTotal)}`
  ];

  const abnormalItems = [...failedItems, ...skippedItems];
  if (abnormalItems.length > 0) {
    lines.push('', '异常明细：');
    abnormalItems.slice(0, 10).forEach((item, index) => {
      const reason = item.result?.errorMessage || item.result?.rewardNote || '未知原因';
      lines.push(`${index + 1}. ${notificationAccountLabel(item)}：${truncateLine(reason)}`);
    });
    if (abnormalItems.length > 10) {
      lines.push(`还有 ${abnormalItems.length - 10} 条异常未展示。`);
    }
  }

  return limitTelegramText(lines.join('\n'));
}

export function buildPublicCheckinErrorMessage(error: unknown, now = new Date()): string {
  const message = error instanceof Error ? error.message : asString(error).trim() || '未知异常';
  return limitTelegramText([
    '公益站定时签到异常',
    `时间：${formatDateTime(now)}`,
    `错误：${truncateLine(message, 1200)}`
  ].join('\n'));
}

export async function sendPublicCheckinSchedulerSummaryNotification(
  db: D1Database,
  items: PublicCheckinNotificationItem[]
): Promise<void> {
  const result = await sendConfiguredTelegramMessage(db, buildPublicCheckinSummaryMessage(items));
  if (!result.ok && result.message !== 'Telegram 通知未启用') {
    throw new Error(result.message);
  }
}

export async function sendPublicCheckinSchedulerErrorNotification(db: D1Database, error: unknown): Promise<void> {
  const result = await sendConfiguredTelegramMessage(db, buildPublicCheckinErrorMessage(error));
  if (!result.ok && result.message !== 'Telegram 通知未启用') {
    throw new Error(result.message);
  }
}

export function registerNotificationRoutes(app: Hono<any>): void {
  app.get('/api/system/notification-config', async (c) => {
    return c.json({ item: await getNotificationConfig(c.env.DB) });
  });

  app.put('/api/system/notification-config', async (c) => {
    const item = await updateNotificationConfig(c.env.DB, await readBody(c));
    return c.json({ item });
  });

  app.post('/api/system/notification-config/test', async (c) => {
    return c.json(await sendTelegramTestNotification(c.env.DB));
  });
}

export const notificationTestHooks = {
  normalizeStoredNotificationConfig,
  toPublicNotificationConfig,
  validateTelegramBotToken,
  validateStoredNotificationConfig,
  mergeNotificationConfig,
  buildPublicCheckinSummaryMessage,
  buildPublicCheckinErrorMessage,
  limitTelegramText
};
