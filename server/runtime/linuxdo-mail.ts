import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

export interface LinuxDoMailPublicConfig {
  email: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  useSystemProxy: boolean;
  tokenConfigured: boolean;
  updatedAt: string | null;
}

interface LinuxDoMailStoredConfig {
  email: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  useSystemProxy: boolean;
  authTokenEncrypted: string;
  updatedAt: string | null;
}

interface LinuxDoMailRuntimeConfig extends LinuxDoMailPublicConfig {
  authToken: string;
  proxyUrl: string;
}

interface MailRecipient {
  name: string;
  address: string;
  display: string;
}

interface AccountMailItem {
  id: string;
  subject: string;
  from: string;
  toRecipients?: MailRecipient[];
  ccRecipients?: MailRecipient[];
  matchedRecipients?: string[];
  recipientMatchKind?: 'requested' | 'other' | 'unknown';
  receivedAt: string;
  preview: string;
  contentType: string;
  content: string;
  folderKind: 'inbox' | 'junk';
  folderLabel: string;
  isRead: boolean | null;
}

interface LinuxDoMailSendPayload {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
}

const LINUXDO_MAIL_CONFIG_KEY = 'linuxdo_mail_config';
const LINUXDO_MAIL_READ_SERVICE = 'linuxdo-mail';
const SYSTEM_PROXY_CONFIG_KEY = 'system_proxy_config';
const DEFAULT_LINUXDO_MAIL_HOST = 'mail.linux.do';
const DEFAULT_LINUXDO_MAIL_CONFIG: LinuxDoMailStoredConfig = {
  email: '',
  displayName: '',
  imapHost: DEFAULT_LINUXDO_MAIL_HOST,
  imapPort: 993,
  smtpHost: DEFAULT_LINUXDO_MAIL_HOST,
  smtpPort: 465,
  useSystemProxy: false,
  authTokenEncrypted: '',
  updatedAt: null
};
const DEFAULT_MESSAGE_LIMIT = 30;
const MAX_MESSAGE_LIMIT = 50;
const MAX_SUBJECT_LENGTH = 300;
const MAX_BODY_LENGTH = 200_000;
const MAX_RECIPIENT_COUNT = 50;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1 ? true : value === 0 ? false : fallback;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizeEmail(value: unknown): string {
  return asString(value).trim().toLowerCase();
}

function normalizeHost(value: unknown, fallback = DEFAULT_LINUXDO_MAIL_HOST): string {
  const host = asString(value).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return host || fallback;
}

function normalizePort(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function normalizeLimit(value: unknown): number {
  const parsed = Number.parseInt(asString(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.min(parsed, MAX_MESSAGE_LIMIT);
}

function validateEmail(email: string, label = '邮箱'): void {
  if (!email) {
    throw new HTTPException(400, { message: `${label}不能为空` });
  }
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HTTPException(400, { message: `${label}格式不合法` });
  }
}

async function dbFirst<T>(db: D1Database, query: string, values: unknown[] = []): Promise<T | null> {
  return db.prepare(query).bind(...values).first<T>();
}

async function dbRun(db: D1Database, query: string, values: unknown[] = []): Promise<D1Result> {
  return db.prepare(query).bind(...values).run();
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => ({}));
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

async function getSystemProxyUrl(db: D1Database): Promise<string> {
  const value = await getAppSetting(db, SYSTEM_PROXY_CONFIG_KEY);
  if (!value) {
    return '';
  }

  try {
    const parsed = asRecord(JSON.parse(value));
    return asString(parsed.proxyUrl).trim();
  } catch {
    return '';
  }
}

async function resolveProxyUrl(db: D1Database, useSystemProxy: boolean): Promise<string> {
  if (!useSystemProxy) {
    return '';
  }
  const proxyUrl = await getSystemProxyUrl(db);
  if (!proxyUrl) {
    throw new HTTPException(400, { message: '已启用系统代理，但系统设置里未配置代理地址' });
  }
  return proxyUrl;
}

function keyPath(): string {
  const explicitDir = process.env.LINUXDO_MAIL_DATA_DIR?.trim() || process.env.DATA_DIR?.trim();
  const dataDir = explicitDir || path.dirname(path.resolve(process.env.DB_PATH || 'data/account-manager.db'));
  return path.resolve(dataDir, 'linuxdo-mail-encryption.key');
}

function normalizeHexKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return null;
  }
  return Buffer.from(trimmed, 'hex');
}

function resolveEncryptionKey(): Buffer {
  const envKey = process.env.LINUXDO_MAIL_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
  if (envKey.trim()) {
    const parsed = normalizeHexKey(envKey);
    if (!parsed) {
      throw new Error('LINUXDO_MAIL_ENCRYPTION_KEY 必须是 32 字节 hex 字符串（64 位十六进制）');
    }
    return parsed;
  }

  const filePath = keyPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const parsed = normalizeHexKey(readFileSync(filePath, 'utf8'));
    if (!parsed) {
      throw new Error(`${filePath} 中的 Linux DO 邮箱加密密钥格式无效`);
    }
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
    throw new Error('Linux DO 邮箱令牌密文格式无效');
  }
  const decipher = createDecipheriv('aes-256-gcm', resolveEncryptionKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function normalizeStoredConfig(input: unknown): LinuxDoMailStoredConfig {
  const record = asRecord(input);
  return {
    email: normalizeEmail(record.email),
    displayName: asString(record.displayName).trim(),
    imapHost: normalizeHost(record.imapHost),
    imapPort: normalizePort(record.imapPort, DEFAULT_LINUXDO_MAIL_CONFIG.imapPort),
    smtpHost: normalizeHost(record.smtpHost),
    smtpPort: normalizePort(record.smtpPort, DEFAULT_LINUXDO_MAIL_CONFIG.smtpPort),
    useSystemProxy: asBoolean(record.useSystemProxy, DEFAULT_LINUXDO_MAIL_CONFIG.useSystemProxy),
    authTokenEncrypted: asString(record.authTokenEncrypted).trim(),
    updatedAt: asString(record.updatedAt).trim() || null
  };
}

function toPublicConfig(config: LinuxDoMailStoredConfig): LinuxDoMailPublicConfig {
  return {
    email: config.email,
    displayName: config.displayName,
    imapHost: config.imapHost,
    imapPort: config.imapPort,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    useSystemProxy: config.useSystemProxy,
    tokenConfigured: Boolean(config.authTokenEncrypted),
    updatedAt: config.updatedAt
  };
}

async function getStoredConfig(db: D1Database): Promise<LinuxDoMailStoredConfig> {
  const value = await getAppSetting(db, LINUXDO_MAIL_CONFIG_KEY);
  if (!value) {
    return DEFAULT_LINUXDO_MAIL_CONFIG;
  }

  try {
    return normalizeStoredConfig(JSON.parse(value));
  } catch {
    return DEFAULT_LINUXDO_MAIL_CONFIG;
  }
}

async function getRuntimeConfig(db: D1Database): Promise<LinuxDoMailRuntimeConfig> {
  const stored = await getStoredConfig(db);
  validateEmail(stored.email);
  if (!stored.authTokenEncrypted) {
    throw new HTTPException(400, { message: 'Linux DO 邮箱尚未配置授权令牌' });
  }

  let authToken = '';
  try {
    authToken = decryptSecret(stored.authTokenEncrypted);
  } catch {
    throw new HTTPException(400, { message: 'Linux DO 邮箱授权令牌无法解密，请重新保存配置' });
  }

  if (!authToken) {
    throw new HTTPException(400, { message: 'Linux DO 邮箱授权令牌为空，请重新保存配置' });
  }

  return {
    ...toPublicConfig(stored),
    authToken,
    proxyUrl: await resolveProxyUrl(db, stored.useSystemProxy)
  };
}

function decryptStoredAuthToken(stored: LinuxDoMailStoredConfig): string {
  if (!stored.authTokenEncrypted) {
    return '';
  }

  try {
    return decryptSecret(stored.authTokenEncrypted);
  } catch {
    throw new HTTPException(400, { message: 'Linux DO 邮箱授权令牌无法解密，请重新保存配置' });
  }
}

function normalizeConfigInput(
  input: unknown,
  previous: LinuxDoMailStoredConfig
): { config: LinuxDoMailStoredConfig; authToken: string } {
  const record = asRecord(input);
  const authToken = asString(record.authToken ?? record.token ?? record.password).trim();
  const clearToken = record.clearToken === true;
  const config: LinuxDoMailStoredConfig = {
    email: normalizeEmail(record.email),
    displayName: asString(record.displayName).trim(),
    imapHost: normalizeHost(record.imapHost),
    imapPort: normalizePort(record.imapPort, DEFAULT_LINUXDO_MAIL_CONFIG.imapPort),
    smtpHost: normalizeHost(record.smtpHost),
    smtpPort: normalizePort(record.smtpPort, DEFAULT_LINUXDO_MAIL_CONFIG.smtpPort),
    useSystemProxy: asBoolean(record.useSystemProxy, previous.useSystemProxy),
    authTokenEncrypted: clearToken ? '' : previous.authTokenEncrypted,
    updatedAt: new Date().toISOString()
  };

  validateEmail(config.email);
  if (config.displayName.length > 120) {
    throw new HTTPException(400, { message: '显示名称最多 120 个字符' });
  }
  if (!config.imapHost || !config.smtpHost) {
    throw new HTTPException(400, { message: 'IMAP 和 SMTP 服务器不能为空' });
  }
  if (authToken.length > 512) {
    throw new HTTPException(400, { message: '授权令牌长度超过限制' });
  }

  return { config, authToken };
}

async function updateConfig(db: D1Database, input: unknown): Promise<LinuxDoMailPublicConfig> {
  const previous = await getStoredConfig(db);
  const { config: next, authToken } = normalizeConfigInput(input, previous);
  if (authToken) {
    next.authTokenEncrypted = encryptSecret(authToken);
  }
  if (!next.authTokenEncrypted) {
    throw new HTTPException(400, { message: '授权令牌不能为空' });
  }

  await setAppSetting(db, LINUXDO_MAIL_CONFIG_KEY, JSON.stringify(next));
  return toPublicConfig(next);
}

async function buildRuntimeConfigFromInput(
  db: D1Database,
  input: unknown
): Promise<LinuxDoMailRuntimeConfig> {
  const previous = await getStoredConfig(db);
  const { config, authToken } = normalizeConfigInput(input, previous);
  const resolvedAuthToken = authToken || decryptStoredAuthToken(previous);

  if (!resolvedAuthToken) {
    throw new HTTPException(400, { message: 'Linux DO 邮箱授权令牌不能为空' });
  }

  return {
    ...toPublicConfig({
      ...config,
      authTokenEncrypted: authToken ? 'configured' : previous.authTokenEncrypted
    }),
    tokenConfigured: true,
    authToken: resolvedAuthToken,
    proxyUrl: await resolveProxyUrl(db, config.useSystemProxy)
  };
}

function sanitizeConnectionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : asString(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('auth') || normalized.includes('login') || normalized.includes('password')) {
    return `${fallback}: 授权失败，请检查邮箱账号和授权令牌`;
  }
  if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('etimedout')) {
    return `${fallback}: 连接超时`;
  }
  if (normalized.includes('econnrefused') || normalized.includes('connection refused')) {
    return `${fallback}: 连接被拒绝`;
  }
  if (normalized.includes('enotfound') || normalized.includes('eai_again')) {
    return `${fallback}: 无法解析服务器地址`;
  }
  if (normalized.includes('proxy')) {
    return `${fallback}: 代理连接失败，请检查系统代理设置`;
  }
  return `${fallback}: ${message || '连接失败'}`;
}

function createImapClient(config: LinuxDoMailRuntimeConfig): ImapFlow {
  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: {
      user: config.email,
      pass: config.authToken
    },
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000,
    proxy: config.proxyUrl || undefined
  });
}

function createSmtpTransport(config: LinuxDoMailRuntimeConfig): ReturnType<typeof nodemailer.createTransport> {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: true,
    auth: {
      user: config.email,
      pass: config.authToken
    },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000,
    proxy: config.proxyUrl || undefined
  });
}

async function testImapConnection(config: LinuxDoMailRuntimeConfig): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const client = createImapClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
    return { ok: true, message: 'IMAP 连接可用' };
  } catch (error) {
    return { ok: false, message: sanitizeConnectionError(error, 'IMAP 连接失败') };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function testSmtpConnection(config: LinuxDoMailRuntimeConfig): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const transporter = createSmtpTransport(config);
  try {
    await transporter.verify();
    return { ok: true, message: 'SMTP 连接可用' };
  } catch (error) {
    return { ok: false, message: sanitizeConnectionError(error, 'SMTP 连接失败') };
  } finally {
    transporter.close?.();
  }
}

async function testConnection(db: D1Database, input?: unknown): Promise<{
  ok: boolean;
  useSystemProxy: boolean;
  proxyConfigured: boolean;
  imap: { ok: boolean; message: string };
  smtp: { ok: boolean; message: string };
}> {
  const config = input && Object.keys(asRecord(input)).length > 0
    ? await buildRuntimeConfigFromInput(db, input)
    : await getRuntimeConfig(db);
  const [imap, smtp] = await Promise.all([testImapConnection(config), testSmtpConnection(config)]);
  return {
    ok: imap.ok && smtp.ok,
    useSystemProxy: config.useSystemProxy,
    proxyConfigured: Boolean(config.proxyUrl),
    imap,
    smtp
  };
}

function normalizeAddress(address: unknown): MailRecipient | null {
  const record = asRecord(address);
  const normalizedAddress = normalizeEmail(record.address);
  if (!normalizedAddress) {
    return null;
  }
  const name = asString(record.name).trim();
  return {
    name,
    address: normalizedAddress,
    display: name ? `${name} <${normalizedAddress}>` : normalizedAddress
  };
}

function normalizeAddressList(input: unknown): MailRecipient[] {
  const items = Array.isArray(input) ? input : [input];
  const recipients: MailRecipient[] = [];
  for (const item of items) {
    const value = asRecord(item).value;
    if (Array.isArray(value)) {
      for (const nested of value) {
        const recipient = normalizeAddress(nested);
        if (recipient) {
          recipients.push(recipient);
        }
      }
      continue;
    }
    const recipient = normalizeAddress(item);
    if (recipient) {
      recipients.push(recipient);
    }
  }
  return recipients;
}

function formatSender(input: unknown): string {
  const recipients = normalizeAddressList(input);
  return recipients[0]?.display || '未知发件人';
}

function normalizeMessageId(value: unknown, fallback: string): string {
  const id = asString(value).trim();
  return id || fallback;
}

function truncateText(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function normalizeFlags(input: unknown): string[] {
  if (input instanceof Set) {
    return Array.from(input).map((flag) => asString(flag).toLowerCase());
  }
  if (Array.isArray(input)) {
    return input.map((flag) => asString(flag).toLowerCase());
  }
  return [];
}

async function toMailItem(message: Record<string, unknown>): Promise<AccountMailItem> {
  const source = message.source;
  const parsed = await simpleParser(source);
  const uid = asString(message.uid).trim();
  const dateValue = parsed.date instanceof Date ? parsed.date : message.internalDate;
  const receivedAt = dateValue instanceof Date && !Number.isNaN(dateValue.getTime())
    ? dateValue.toISOString()
    : new Date().toISOString();
  const html = typeof parsed.html === 'string' ? parsed.html.trim() : '';
  const text = asString(parsed.text).trim();
  const content = html || text;
  const flags = normalizeFlags(message.flags);
  const messageId = normalizeMessageId(parsed.messageId, `linuxdo-${uid || receivedAt}`);

  return {
    id: messageId,
    subject: asString(parsed.subject).trim(),
    from: formatSender(parsed.from),
    toRecipients: normalizeAddressList(parsed.to),
    ccRecipients: normalizeAddressList(parsed.cc),
    receivedAt,
    preview: truncateText(asString(parsed.text || parsed.textAsHtml || parsed.subject), 240),
    contentType: html ? 'text/html' : 'text/plain',
    content,
    folderKind: 'inbox',
    folderLabel: '收件箱',
    isRead: flags.includes('\\seen')
  };
}

async function listMessages(db: D1Database, limit: number): Promise<{ account: string; messages: AccountMailItem[] }> {
  const config = await getRuntimeConfig(db);
  const client = createImapClient(config);
  const messages: AccountMailItem[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { messages: true });
      const totalMessages = Number(status.messages || 0);
      if (totalMessages <= 0) {
        return { account: config.email, messages: [] };
      }
      const start = Math.max(totalMessages - limit + 1, 1);
      for await (const item of client.fetch(`${start}:*`, {
        uid: true,
        source: true,
        flags: true,
        internalDate: true
      })) {
        messages.push(await toMailItem(item as Record<string, unknown>));
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    throw new HTTPException(400, { message: sanitizeConnectionError(error, 'Linux DO 邮件读取失败') });
  } finally {
    await client.logout().catch(() => undefined);
  }

  return {
    account: config.email,
    messages: await applyMailReadMarks(
      db,
      config.email,
      messages.sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt)).slice(0, limit)
    )
  };
}

async function applyMailReadMarks(
  db: D1Database,
  account: string,
  messages: AccountMailItem[]
): Promise<AccountMailItem[]> {
  if (messages.length === 0) {
    return messages;
  }

  const rows = await db.prepare(
    'SELECT message_id AS messageId FROM mail_read_marks WHERE service = ? AND account = ?'
  ).bind(LINUXDO_MAIL_READ_SERVICE, account).all<{ messageId: string }>();
  const marked = new Set((rows.results ?? []).map((row) => row.messageId));
  return messages.map((item) => ({
    ...item,
    isRead: item.isRead || marked.has(item.id)
  }));
}

async function markMailMessageRead(db: D1Database, messageIdInput: unknown): Promise<void> {
  const config = await getStoredConfig(db);
  validateEmail(config.email);
  const messageId = asString(messageIdInput).trim();
  if (!messageId) {
    throw new HTTPException(400, { message: 'messageId 不能为空' });
  }
  await dbRun(db, `
    INSERT OR IGNORE INTO mail_read_marks (service, account, message_id)
    VALUES (?, ?, ?)
  `, [LINUXDO_MAIL_READ_SERVICE, config.email, messageId]);
}

function parseRecipients(value: unknown, label: string, required = false): string[] {
  const raw = asString(value).trim();
  if (!raw) {
    if (required) {
      throw new HTTPException(400, { message: `${label}不能为空` });
    }
    return [];
  }
  const items = raw.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
  if (items.length > MAX_RECIPIENT_COUNT) {
    throw new HTTPException(400, { message: `${label}最多支持 ${MAX_RECIPIENT_COUNT} 个地址` });
  }
  for (const item of items) {
    validateEmail(item, label);
  }
  return Array.from(new Set(items));
}

function normalizeSendPayload(input: unknown): {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
} {
  const record = asRecord(input) as Partial<LinuxDoMailSendPayload>;
  const to = parseRecipients(record.to, '收件人', true);
  const cc = parseRecipients(record.cc, '抄送');
  const bcc = parseRecipients(record.bcc, '密送');
  const subject = asString(record.subject).trim();
  const text = asString(record.text).trim();
  const html = asString(record.html).trim();

  if (!subject) {
    throw new HTTPException(400, { message: '主题不能为空' });
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new HTTPException(400, { message: `主题最多 ${MAX_SUBJECT_LENGTH} 个字符` });
  }
  if (!text && !html) {
    throw new HTTPException(400, { message: '邮件正文不能为空' });
  }
  if (text.length > MAX_BODY_LENGTH || html.length > MAX_BODY_LENGTH) {
    throw new HTTPException(400, { message: '邮件正文过长' });
  }

  return { to, cc, bcc, subject, text, html };
}

function formatFromAddress(config: LinuxDoMailRuntimeConfig): string {
  if (!config.displayName) {
    return config.email;
  }
  const escapedName = config.displayName.replace(/["\\]/g, '\\$&');
  return `"${escapedName}" <${config.email}>`;
}

async function sendMail(db: D1Database, input: unknown): Promise<{ ok: true; messageId: string }> {
  const config = await getRuntimeConfig(db);
  const payload = normalizeSendPayload(input);
  const transporter = createSmtpTransport(config);

  try {
    const result = await transporter.sendMail({
      from: formatFromAddress(config),
      to: payload.to,
      cc: payload.cc.length ? payload.cc : undefined,
      bcc: payload.bcc.length ? payload.bcc : undefined,
      subject: payload.subject,
      text: payload.text || undefined,
      html: payload.html || undefined
    });
    return {
      ok: true,
      messageId: asString(result.messageId).trim()
    };
  } catch (error) {
    throw new HTTPException(400, { message: sanitizeConnectionError(error, 'Linux DO 邮件发送失败') });
  } finally {
    transporter.close?.();
  }
}

export function registerLinuxDoMailRoutes(app: Hono<any>): void {
  app.get('/api/linuxdo-mail/config', async (c) => {
    return c.json({ item: toPublicConfig(await getStoredConfig(c.env.DB)) });
  });

  app.put('/api/linuxdo-mail/config', async (c) => {
    return c.json({ item: await updateConfig(c.env.DB, await readBody(c)) });
  });

  app.post('/api/linuxdo-mail/test-connection', async (c) => {
    return c.json(await testConnection(c.env.DB, await readBody(c)));
  });

  app.get('/api/linuxdo-mail/messages', async (c) => {
    return c.json(await listMessages(c.env.DB, normalizeLimit(c.req.query('limit'))));
  });

  app.post('/api/linuxdo-mail/messages/read', async (c) => {
    const body = await readBody(c);
    await markMailMessageRead(c.env.DB, asRecord(body).messageId);
    return c.json({ ok: true as const });
  });

  app.post('/api/linuxdo-mail/send', async (c) => {
    return c.json(await sendMail(c.env.DB, await readBody(c)));
  });
}

export const linuxDoMailTestHooks = {
  normalizeStoredConfig,
  toPublicConfig,
  updateConfig,
  normalizeSendPayload,
  parseRecipients,
  encryptSecret,
  decryptSecret
};
