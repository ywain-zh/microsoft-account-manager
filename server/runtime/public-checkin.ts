import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { fetch, ProxyAgent, type Dispatcher, type RequestInit as UndiciRequestInit } from 'undici';

export type PublicCheckinPlatform = 'new-api' | 'one-api' | 'onehub' | 'anyrouter';
type StoredPublicCheckinPlatform = Exclude<PublicCheckinPlatform, 'anyrouter'>;
export type PublicCheckinCredentialType = 'password' | 'access_token' | 'cookie';
export type PublicCheckinAccountStatus = 'active' | 'disabled' | 'error';
export type PublicCheckinStatus = 'success' | 'failed' | 'skipped';
export type PublicCheckinTriggeredBy = 'scheduler' | 'manual';
export type PublicCheckinDailyBalanceDisplayMode = 'none' | 'reward' | 'usage';

export interface PublicCheckinSite {
  id: number;
  name: string;
  url: string;
  platform: PublicCheckinPlatform;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface PublicCheckinCredential {
  type: PublicCheckinCredentialType;
  username?: string;
  password?: string;
  accessToken?: string;
  cookie?: string;
  platformUserId?: number;
}

export interface PublicCheckinAccount {
  id: number;
  siteId: number;
  label: string;
  credentialType: PublicCheckinCredentialType;
  hasCredential: boolean;
  hasApiKey: boolean;
  balance: number | null;
  balanceUpdatedAt: number | null;
  checkinEnabled: boolean;
  useProxy: boolean;
  status: PublicCheckinAccountStatus;
  lastError: string | null;
  dailyBalanceDisplayMode: PublicCheckinDailyBalanceDisplayMode;
  dailyBalanceDisplayAmount: number | null;
  announcementUnreadCount: number;
  healthState: 'normal' | 'abnormal' | 'failed' | 'unknown';
  healthMessage: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  site: PublicCheckinSite;
}

export type PublicCheckinAnnouncementLevel = 'info' | 'warning' | 'error';

export interface PublicCheckinAnnouncement {
  id: number;
  siteId: number;
  sourceKey: string;
  title: string;
  content: string;
  level: PublicCheckinAnnouncementLevel;
  sourceUrl: string | null;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  readAt: number | null;
}

type SiteRow = {
  id: number;
  name: string;
  url: string;
  platform: PublicCheckinPlatform;
  created_at: number | null;
  updated_at: number | null;
};

type AccountRow = {
  id: number;
  site_id: number;
  label: string;
  credential_type: PublicCheckinCredentialType;
  credential_data: string;
  api_key_data: string | null;
  balance: number | null;
  balance_updated_at: number | null;
  checkin_enabled: number;
  use_proxy: number;
  status: PublicCheckinAccountStatus;
  last_error: string | null;
  created_at: number | null;
  updated_at: number | null;
};

type JoinedAccountRow = {
  account_id: number;
  site_id: number;
  label: string;
  credential_type: PublicCheckinCredentialType;
  credential_data: string;
  api_key_data: string | null;
  balance: number | null;
  balance_updated_at: number | null;
  checkin_enabled: number;
  use_proxy: number;
  status: PublicCheckinAccountStatus;
  last_error: string | null;
  account_created_at: number | null;
  account_updated_at: number | null;
  site_name: string;
  site_url: string;
  site_platform: PublicCheckinPlatform;
  site_created_at: number | null;
  site_updated_at: number | null;
};

interface AccountWithSite {
  account: AccountRow;
  site: SiteRow;
}

interface CheckinResult {
  success: boolean;
  reward?: number | null;
  rewardNote?: string | null;
  errorMessage?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
}

interface BalanceResult {
  success: boolean;
  balance?: number;
  errorMessage?: string;
}

interface PublicCheckinModelProbeItem {
  model: string;
}

interface PublicCheckinModelProbeResponse {
  accountId: number;
  siteName: string;
  items: PublicCheckinModelProbeItem[];
}

interface PublicCheckinSingleModelProbeResponse {
  accountId: number;
  siteName: string;
  model: string;
  success: boolean;
  prompt: string;
  responseText: string | null;
  errorMessage: string | null;
  latencyMs: number;
  checkedAt: number;
}

interface PublicCheckinModelCacheEntry {
  expiresAt: number;
  response: PublicCheckinModelProbeResponse;
}

interface LoginResult {
  success: boolean;
  accessToken?: string;
  errorMessage?: string;
}

interface PublicCheckinSettings {
  checkinCron: string;
  checkinTime: string;
  timezone: string;
  announcementPollingIntervalMinutes: 15 | 30 | 60;
}

interface YesCaptchaConfig {
  clientKey: string;
}

type PublicCheckinAnnouncementRow = {
  id: number;
  site_id: number;
  source_key: string;
  title: string;
  content: string;
  level: PublicCheckinAnnouncementLevel;
  source_url: string | null;
  first_seen_at: number | null;
  last_seen_at: number | null;
  read_at: number | null;
};

type PublicCheckinDailyBalanceBaselineRow = {
  id: number;
  account_id: number;
  local_date: string;
  baseline_balance: number;
  captured_at: number;
  created_at: number;
  updated_at: number;
};

type PublicCheckinLatestRewardRow = {
  account_id: number;
  reward: number | null;
  executed_at: number;
};

type NormalizedAnnouncementInput = {
  sourceKey: string;
  title: string;
  content: string;
  level: PublicCheckinAnnouncementLevel;
  sourceUrl: string | null;
};

const DEFAULT_SETTINGS: PublicCheckinSettings = {
  checkinCron: process.env.CHECKIN_CRON || '0 8 * * *',
  checkinTime: '08:00',
  timezone: process.env.TZ || 'Asia/Shanghai',
  announcementPollingIntervalMinutes: 30
};
const SYSTEM_PROXY_CONFIG_KEY = 'system_proxy_config';
const YESCAPTCHA_CONFIG_KEY = 'yescaptcha_config';
const DEFAULT_YESCAPTCHA_CONFIG: YesCaptchaConfig = {
  clientKey: ''
};
const DEFAULT_PUBLIC_CHECKIN_MODEL_CACHE_TTL_MS = 60_000;
const ANNOUNCEMENT_POLLING_INTERVALS = [15, 30, 60] as const;

const runningTasks = new Set<string>();
let checkinSchedule: SimpleCronTask | null = null;
let balanceSchedule: SimpleCronTask | null = null;
let announcementPollTimer: ReturnType<typeof setTimeout> | null = null;
let announcementPollingInFlight = false;
let announcementPollingBootstrapped = false;
let schedulerDb: D1Database | null = null;
let schedulerStarted = false;
const publicCheckinModelCache = new Map<string, PublicCheckinModelCacheEntry>();
const publicCheckinModelRequests = new Map<string, Promise<PublicCheckinModelProbeResponse>>();
let openAiCompatibleFetchOverride:
  | ((url: string, init: UndiciRequestInit) => Promise<RawResponse>)
  | null = null;

type NotificationsModule = typeof import('./notifications.js');
let notificationsModulePromise: Promise<NotificationsModule> | null = null;
let adapterOverride: ((platform: PublicCheckinPlatform, siteUrl: string, options: AdapterOptions, siteName?: string) => PublicCheckinAdapter) | null = null;
let announcementNotificationSenderOverride:
  | ((db: D1Database, item: { siteName: string; title: string; content: string; sourceUrl?: string | null; discoveredAt?: number | null }) => Promise<void>)
  | null = null;

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

function asPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function loadNotificationsModule(): Promise<NotificationsModule> {
  notificationsModulePromise ??= import('./notifications.js').catch((error) => {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ERR_MODULE_NOT_FOUND') {
      return import('./notifications.ts' as string) as Promise<NotificationsModule>;
    }
    throw error;
  });
  return notificationsModulePromise;
}

async function sendSchedulerSummaryNotification(
  db: D1Database,
  results: Awaited<ReturnType<typeof runCheckinAll>>
): Promise<void> {
  const notifications = await loadNotificationsModule();
  await notifications.sendPublicCheckinSchedulerSummaryNotification(db, results);
}

async function sendSchedulerErrorNotification(db: D1Database, error: unknown): Promise<void> {
  const notifications = await loadNotificationsModule();
  await notifications.sendPublicCheckinSchedulerErrorNotification(db, error);
}

async function sendAnnouncementNotification(
  db: D1Database,
  item: { siteName: string; title: string; content: string; sourceUrl?: string | null; discoveredAt?: number | null }
): Promise<void> {
  if (announcementNotificationSenderOverride) {
    await announcementNotificationSenderOverride(db, item);
    return;
  }

  const notifications = await loadNotificationsModule();
  await notifications.sendPublicCheckinAnnouncementNotification(db, item);
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeUrl(url: string): string {
  const value = url.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error();
    }
  } catch {
    throw new HTTPException(400, { message: '站点 URL 格式不正确' });
  }
  return value;
}

function isAnyRouterSite(nameOrUrl: string): boolean {
  return /\bany\s*router\b/i.test(nameOrUrl) || /(^|\.)anyrouter\./i.test(nameOrUrl);
}

function inferPublicCheckinPlatform(input: {
  name?: string;
  url?: string;
  platform?: PublicCheckinPlatform;
}): PublicCheckinPlatform {
  if (input.platform === 'new-api' && isAnyRouterSite(`${input.name || ''} ${input.url || ''}`)) {
    return 'anyrouter';
  }
  return input.platform || 'new-api';
}

function formatZonedLocalDate(timestampSeconds: number, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date(timestampSeconds * 1000));
  const read = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function toStoredPublicCheckinPlatform(platform: PublicCheckinPlatform): StoredPublicCheckinPlatform {
  return platform === 'anyrouter' ? 'new-api' : platform;
}

function normalizePlatform(value: unknown): PublicCheckinPlatform {
  const platform = asString(value).trim();
  if (platform === 'new-api' || platform === 'one-api' || platform === 'onehub' || platform === 'anyrouter') return platform;
  throw new HTTPException(400, { message: '平台类型不支持' });
}

function normalizeCredentialType(value: unknown): PublicCheckinCredentialType {
  const type = asString(value).trim();
  if (type === 'password' || type === 'access_token' || type === 'cookie') return type;
  throw new HTTPException(400, { message: '凭证类型不支持' });
}

function normalizeAccountStatus(value: unknown, fallback: PublicCheckinAccountStatus = 'active'): PublicCheckinAccountStatus {
  const status = asString(value).trim();
  if (!status) return fallback;
  if (status === 'active' || status === 'disabled' || status === 'error') return status;
  throw new HTTPException(400, { message: '账号状态不支持' });
}

function normalizeCheckinStatus(value: unknown): PublicCheckinStatus | undefined {
  const status = asString(value).trim();
  if (!status) return undefined;
  if (status === 'success' || status === 'failed' || status === 'skipped') return status;
  throw new HTTPException(400, { message: '签到状态不支持' });
}

function normalizeCookieHeader(value: string): string {
  const cookieLines = value
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const cookieMatch = line.match(/^cookie\s*:\s*(.+)$/i);
      if (cookieMatch) return [cookieMatch[1]];
      if (/^[\w!#$%&'*+.^`|~-]+\s*:/.test(line)) return [];
      return [line];
    });

  return cookieLines
    .join('; ')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^[^=;\s]+=.*/.test(part))
    .join('; ');
}

function extractPlatformUserIdFromHeaders(value: string): number | undefined {
  const match = value.match(/^new-api-user\s*:\s*(\d+)\s*$/im);
  if (!match) return undefined;
  return asPositiveInt(match[1]);
}

function normalizeCredentialInput(input: PublicCheckinCredential): PublicCheckinCredential {
  if (input.type === 'password') {
    if (!asString(input.username).trim() || !asString(input.password).trim()) {
      throw new HTTPException(400, { message: '密码模式需要用户名和密码' });
    }
    return {
      type: 'password',
      username: asString(input.username).trim(),
      password: asString(input.password)
    };
  }

  if (input.type === 'access_token') {
    if (!asString(input.accessToken).trim()) {
      throw new HTTPException(400, { message: 'access_token 模式需要 token' });
    }
    return {
      type: 'access_token',
      accessToken: asString(input.accessToken).trim(),
      platformUserId: input.platformUserId
    };
  }

  if (!asString(input.cookie).trim()) {
    throw new HTTPException(400, { message: 'cookie 模式需要 cookie' });
  }

  const rawCookie = asString(input.cookie);
  const platformUserId = input.platformUserId || extractPlatformUserIdFromHeaders(rawCookie);
  return {
    type: 'cookie',
    cookie: normalizeCookieHeader(rawCookie),
    platformUserId
  };
}

function parseCredential(value: unknown, type: PublicCheckinCredentialType): PublicCheckinCredential {
  const input = asRecord(value);
  return normalizeCredentialInput({
    type,
    username: asString(input.username),
    password: asString(input.password),
    accessToken: asString(input.accessToken),
    cookie: asString(input.cookie),
    platformUserId: asPositiveInt(input.platformUserId)
  });
}

function validateSiteInput(value: unknown): Pick<PublicCheckinSite, 'name' | 'url' | 'platform'> {
  const input = asRecord(value);
  const name = asString(input.name).trim();
  if (!name) throw new HTTPException(400, { message: '站点名称不能为空' });
  const url = normalizeUrl(asString(input.url));
  const requestedPlatform = normalizePlatform(input.platform);
  return {
    name,
    url,
    platform: toStoredPublicCheckinPlatform(inferPublicCheckinPlatform({ name, url, platform: requestedPlatform }))
  };
}

function validateAccountInput(value: unknown, requireCredential: boolean): {
  siteId?: number;
  site?: Pick<PublicCheckinSite, 'name' | 'url' | 'platform'>;
  label: string;
  credentialType: PublicCheckinCredentialType;
  credential: PublicCheckinCredential | null;
  apiKey: string | null;
  checkinEnabled: boolean;
  useProxy: boolean;
  status?: PublicCheckinAccountStatus;
} {
  const input = asRecord(value);
  const siteId = asPositiveInt(input.siteId);
  const site = input.site ? validateSiteInput(input.site) : undefined;
  if (!siteId && !site) {
    throw new HTTPException(400, { message: '必须选择已有站点或新建站点' });
  }

  const credentialType = normalizeCredentialType(input.credentialType);
  const credential = input.credential ? parseCredential(input.credential, credentialType) : null;
  if (requireCredential && !credential) {
    throw new HTTPException(400, { message: '新增账号必须提供凭证' });
  }
  const apiKeyInput = asString(input.apiKey).trim();

  return {
    siteId,
    site,
    label: asString(input.label).trim(),
    credentialType,
    credential,
    apiKey: apiKeyInput ? normalizeApiKey(apiKeyInput) : null,
    checkinEnabled: asBoolean(input.checkinEnabled, true),
    useProxy: asBoolean(input.useProxy, false),
    status: input.status === undefined ? undefined : normalizeAccountStatus(input.status)
  };
}

function normalizeApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length > 2048) {
    throw new HTTPException(400, { message: 'API Key 长度不能超过 2048 个字符' });
  }
  return trimmed;
}

async function dbAll<T>(db: D1Database, query: string, values: unknown[] = []): Promise<T[]> {
  const statement = values.length > 0 ? db.prepare(query).bind(...values) : db.prepare(query);
  const { results } = await statement.all<T>();
  return results;
}

async function dbFirst<T>(db: D1Database, query: string, values: unknown[] = []): Promise<T | null> {
  const statement = values.length > 0 ? db.prepare(query).bind(...values) : db.prepare(query);
  return statement.first<T>();
}

async function dbRun(db: D1Database, query: string, values: unknown[] = []): Promise<D1Result> {
  const statement = values.length > 0 ? db.prepare(query).bind(...values) : db.prepare(query);
  return statement.run();
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
  if (!value) return '';
  try {
    const parsed = asRecord(JSON.parse(value));
    return asString(parsed.proxyUrl).trim();
  } catch {
    return '';
  }
}

function normalizeYesCaptchaConfig(input: unknown): YesCaptchaConfig {
  const record = asRecord(input);
  return {
    clientKey: asString(record.clientKey).trim()
  };
}

function validateYesCaptchaClientKey(clientKey: string): void {
  if (!clientKey) return;
  if (clientKey.length > 512) {
    throw new HTTPException(400, { message: 'YesCaptcha clientKey 长度不能超过 512 个字符' });
  }
  if (/\s/.test(clientKey)) {
    throw new HTTPException(400, { message: 'YesCaptcha clientKey 不能包含空白字符' });
  }
}

async function getYesCaptchaConfig(db: D1Database): Promise<YesCaptchaConfig> {
  const value = await getAppSetting(db, YESCAPTCHA_CONFIG_KEY);
  if (!value) return DEFAULT_YESCAPTCHA_CONFIG;
  try {
    return normalizeYesCaptchaConfig(JSON.parse(value));
  } catch {
    return DEFAULT_YESCAPTCHA_CONFIG;
  }
}

async function updateYesCaptchaConfig(db: D1Database, input: unknown): Promise<YesCaptchaConfig> {
  const next = normalizeYesCaptchaConfig(input);
  validateYesCaptchaClientKey(next.clientKey);
  await setAppSetting(db, YESCAPTCHA_CONFIG_KEY, JSON.stringify(next));
  return next;
}

async function getConfiguredYesCaptchaClientKey(db: D1Database): Promise<string> {
  const config = await getYesCaptchaConfig(db);
  return config.clientKey || getEnvYesCaptchaClientKey();
}

async function createAdapterForAccount(
  db: D1Database,
  platform: PublicCheckinPlatform,
  siteUrl: string,
  useProxy: boolean,
  siteName = ''
): Promise<PublicCheckinAdapter> {
  const factory = adapterOverride ?? createAdapter;
  return factory(platform, siteUrl, {
    useProxy,
    proxyUrl: useProxy ? await getSystemProxyUrl(db) : '',
    yesCaptchaClientKey: await getConfiguredYesCaptchaClientKey(db)
  }, siteName);
}

function announcementFromRow(row: PublicCheckinAnnouncementRow): PublicCheckinAnnouncement {
  return {
    id: Number(row.id),
    siteId: Number(row.site_id),
    sourceKey: row.source_key,
    title: row.title,
    content: row.content,
    level: row.level,
    sourceUrl: row.source_url,
    firstSeenAt: row.first_seen_at == null ? null : Number(row.first_seen_at),
    lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
    readAt: row.read_at == null ? null : Number(row.read_at)
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function stripAnnouncementHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeAnnouncementBody(value: unknown): string {
  const text = asString(value).trim();
  if (!text) {
    return '';
  }

  const plain = /<\/?[a-z][\s\S]*>/i.test(text) ? stripAnnouncementHtml(text) : decodeHtmlEntities(text);
  return plain
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeAnnouncementContent(value: unknown): string {
  return asString(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function normalizeAnnouncementLevel(value: unknown, fallback: PublicCheckinAnnouncementLevel = 'info'): PublicCheckinAnnouncementLevel {
  const text = asString(value).trim().toLowerCase();
  if (!text) {
    return fallback;
  }
  if (['error', 'danger', 'critical', 'fatal', 'urgent'].some((item) => text.includes(item))) {
    return 'error';
  }
  if (['warning', 'warn', 'important', 'system', 'notice'].some((item) => text.includes(item))) {
    return 'warning';
  }
  return 'info';
}

function buildAnnouncementSourceKey(content: string, upstreamId = ''): string {
  const normalizedId = upstreamId.trim();
  if (normalizedId) {
    return `id:${normalizedId}`;
  }

  const fingerprint = normalizeAnnouncementBody(content) || normalizeAnnouncementContent(content);
  return `hash:${createHash('sha1').update(fingerprint, 'utf8').digest('hex')}`;
}

function firstNonEmptyField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key]).trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeAnnouncementCandidate(
  candidate: unknown,
  options: {
    fallbackTitle?: string;
    defaultLevel?: PublicCheckinAnnouncementLevel;
  } = {}
): NormalizedAnnouncementInput | null {
  if (typeof candidate === 'string') {
    const content = normalizeAnnouncementContent(candidate);
    if (!content) {
      return null;
    }
    return {
      sourceKey: buildAnnouncementSourceKey(content),
      title: options.fallbackTitle || '站点公告',
      content,
      level: options.defaultLevel || 'info',
      sourceUrl: null
    };
  }

  const record = asRecord(candidate);
  if (Object.keys(record).length === 0) {
    return null;
  }

  const upstreamId = firstNonEmptyField(record, [
    'sourceKey',
    'source_key',
    'id',
    '_id',
    'uuid',
    'noticeId',
    'notice_id',
    'announcementId',
    'announcement_id',
    'key'
  ]);

  const title = firstNonEmptyField(record, [
    'title',
    'subject',
    'name',
    'noticeTitle',
    'notice_title',
    'announcementTitle',
    'announcement_title'
  ]) || options.fallbackTitle || '站点公告';

  const sourceUrl = firstNonEmptyField(record, [
    'sourceUrl',
    'source_url',
    'url',
    'link',
    'href'
  ]) || null;

  const directContent = [
    record.content,
    record.html,
    record.body,
    record.message,
    record.msg,
    record.notice,
    record.text,
    record.description,
    record.systemNotice,
    record.system_notice,
    record.announcement
  ].find((value) => asString(value).trim());

  const content = normalizeAnnouncementContent(
    directContent
    ?? (typeof record.data === 'string' ? record.data : '')
  );

  if (!content) {
    return null;
  }

  return {
    sourceKey: buildAnnouncementSourceKey(content, upstreamId),
    title,
    content,
    level: normalizeAnnouncementLevel(record.level ?? record.type ?? record.severity, options.defaultLevel || 'info'),
    sourceUrl
  };
}

function extractAnnouncementsFromNoticePayload(payload: unknown): NormalizedAnnouncementInput[] {
  const record = asRecord(payload);
  const data = record.data;
  const extracted: NormalizedAnnouncementInput[] = [];

  const pushCandidate = (
    candidate: unknown,
    options: {
      fallbackTitle?: string;
      defaultLevel?: PublicCheckinAnnouncementLevel;
    } = {}
  ): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => pushCandidate(item, options));
      return;
    }

    const normalized = normalizeAnnouncementCandidate(candidate, options);
    if (normalized) {
      extracted.push(normalized);
    }
  };

  pushCandidate(Array.isArray(data) ? data : [], { fallbackTitle: '站点公告' });
  pushCandidate(Array.isArray(payload) ? payload : [], { fallbackTitle: '站点公告' });

  const noticeFields: Array<[string, PublicCheckinAnnouncementLevel, string]> = [
    ['notice', 'info', '通知'],
    ['notification', 'info', '通知'],
    ['announcement', 'info', '公告'],
    ['systemNotice', 'warning', '系统公告'],
    ['system_notice', 'warning', '系统公告'],
    ['systemAnnouncement', 'warning', '系统公告'],
    ['system_announcement', 'warning', '系统公告']
  ];

  const listFields: Array<[string, PublicCheckinAnnouncementLevel, string]> = [
    ['notices', 'info', '通知'],
    ['noticeList', 'info', '通知'],
    ['notice_list', 'info', '通知'],
    ['notifications', 'info', '通知'],
    ['announcements', 'info', '公告'],
    ['items', 'info', '公告'],
    ['list', 'info', '公告'],
    ['records', 'info', '公告'],
    ['systemNotices', 'warning', '系统公告'],
    ['systemNoticeList', 'warning', '系统公告'],
    ['system_notice_list', 'warning', '系统公告']
  ];

  const recordsToSearch = [record, asRecord(data)];
  for (const target of recordsToSearch) {
    for (const [field, level, title] of noticeFields) {
      if (field in target) {
        pushCandidate(target[field], { fallbackTitle: title, defaultLevel: level });
      }
    }
    for (const [field, level, title] of listFields) {
      if (field in target) {
        pushCandidate(target[field], { fallbackTitle: title, defaultLevel: level });
      }
    }
  }

  if (extracted.length === 0 && typeof data === 'string') {
    pushCandidate(data, { fallbackTitle: '站点公告' });
  }

  const deduped = new Map<string, NormalizedAnnouncementInput>();
  for (const item of extracted) {
    if (!deduped.has(item.sourceKey)) {
      deduped.set(item.sourceKey, item);
    }
  }
  return Array.from(deduped.values());
}

function siteFromRow(row: SiteRow): PublicCheckinSite {
  return {
    id: Number(row.id),
    name: row.name,
    url: row.url,
    platform: row.platform,
    createdAt: row.created_at == null ? null : Number(row.created_at),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at)
  };
}

function joinedToAccountWithSite(row: JoinedAccountRow): AccountWithSite {
  return {
    account: {
      id: Number(row.account_id),
      site_id: Number(row.site_id),
      label: row.label,
      credential_type: row.credential_type,
      credential_data: row.credential_data,
      api_key_data: row.api_key_data,
      balance: row.balance == null ? null : Number(row.balance),
      balance_updated_at: row.balance_updated_at == null ? null : Number(row.balance_updated_at),
      checkin_enabled: Number(row.checkin_enabled),
      use_proxy: Number(row.use_proxy),
      status: row.status,
      last_error: row.last_error,
      created_at: row.account_created_at == null ? null : Number(row.account_created_at),
      updated_at: row.account_updated_at == null ? null : Number(row.account_updated_at)
    },
    site: {
      id: Number(row.site_id),
      name: row.site_name,
      url: row.site_url,
      platform: row.site_platform,
      created_at: row.site_created_at == null ? null : Number(row.site_created_at),
      updated_at: row.site_updated_at == null ? null : Number(row.site_updated_at)
    }
  };
}

function toSafeAccount(
  account: AccountRow,
  site: SiteRow,
  dailyBalanceDisplay: {
    mode: PublicCheckinDailyBalanceDisplayMode;
    amount: number | null;
  } = { mode: 'none', amount: null },
  announcementUnreadCount = 0
): PublicCheckinAccount {
  const health = resolveHealth(account);
  return {
    id: Number(account.id),
    siteId: Number(account.site_id),
    label: account.label,
    credentialType: account.credential_type,
    hasCredential: Boolean(account.credential_data),
    hasApiKey: Boolean(account.api_key_data),
    balance: account.balance == null ? null : Number(account.balance),
    balanceUpdatedAt: account.balance_updated_at == null ? null : Number(account.balance_updated_at),
    checkinEnabled: Number(account.checkin_enabled) === 1,
    useProxy: Number(account.use_proxy) === 1,
    status: account.status,
    lastError: account.last_error,
    dailyBalanceDisplayMode: dailyBalanceDisplay.mode,
    dailyBalanceDisplayAmount: dailyBalanceDisplay.amount,
    announcementUnreadCount,
    ...health,
    createdAt: account.created_at == null ? null : Number(account.created_at),
    updatedAt: account.updated_at == null ? null : Number(account.updated_at),
    site: siteFromRow(site)
  };
}

function resolveHealth(account: AccountRow): Pick<PublicCheckinAccount, 'healthState' | 'healthMessage'> {
  if (!account.balance_updated_at && !account.last_error) {
    return { healthState: 'unknown', healthMessage: '未检测' };
  }
  if (account.status === 'error') {
    return { healthState: 'failed', healthMessage: account.last_error || '检测失败' };
  }
  if (account.last_error) {
    return { healthState: 'abnormal', healthMessage: account.last_error };
  }
  return { healthState: 'normal', healthMessage: '运行正常' };
}

function keyPath(): string {
  const explicitDir = process.env.PUBLIC_CHECKIN_DATA_DIR?.trim() || process.env.DATA_DIR?.trim();
  const dataDir = explicitDir || path.dirname(path.resolve(process.env.DB_PATH || 'data/account-manager.db'));
  return path.resolve(dataDir, 'public-checkin-encryption.key');
}

function normalizeHexKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  return Buffer.from(trimmed, 'hex');
}

function resolveEncryptionKey(): Buffer {
  const envKey = process.env.PUBLIC_CHECKIN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
  if (envKey.trim()) {
    const parsed = normalizeHexKey(envKey);
    if (!parsed) throw new Error('PUBLIC_CHECKIN_ENCRYPTION_KEY 必须是 32 字节 hex 字符串（64 位十六进制）');
    return parsed;
  }

  const filePath = keyPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const parsed = normalizeHexKey(readFileSync(filePath, 'utf8'));
    if (!parsed) throw new Error(`${filePath} 中的公益站签到加密密钥格式无效`);
    return parsed;
  }

  const generated = randomBytes(32);
  writeFileSync(filePath, generated.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return generated;
}

function encryptCredential(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ciphertext, tag].map((part) => part.toString('base64')).join(':');
}

function decryptCredentialText(ciphertext: string): string {
  const [ivRaw, encryptedRaw, tagRaw] = ciphertext.split(':');
  if (!ivRaw || !encryptedRaw || !tagRaw) {
    throw new Error('凭证密文格式无效');
  }
  const decipher = createDecipheriv('aes-256-gcm', resolveEncryptionKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function decryptAccountCredential(account: Pick<AccountRow, 'credential_data'>): PublicCheckinCredential {
  return normalizeCredentialInput(JSON.parse(decryptCredentialText(account.credential_data)) as PublicCheckinCredential);
}

function decryptAccountApiKey(account: Pick<AccountRow, 'api_key_data'>): string {
  if (!account.api_key_data) {
    return '';
  }

  return normalizeApiKey(decryptCredentialText(account.api_key_data));
}

export function parsePublicCheckinRewardAmount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') return undefined;
  const match = value.replace(/,/g, '').match(/(?:获得|奖励|收入|reward)?\s*([-+]?\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function inferPublicCheckinRewardFromBalanceDelta(previousBalance: unknown, latestBalance: unknown): number | null {
  const before = typeof previousBalance === 'number' && Number.isFinite(previousBalance)
    ? previousBalance
    : null;
  const after = typeof latestBalance === 'number' && Number.isFinite(latestBalance)
    ? latestBalance
    : null;
  if (before == null || after == null) return null;

  const delta = after - before;
  if (!Number.isFinite(delta) || delta <= 0) return null;
  return Math.round(delta * 1_000_000) / 1_000_000;
}

function buildCheckinResultForNotification(
  result: CheckinResult,
  status: PublicCheckinStatus,
  reward: number | null,
  balanceBefore?: number | null,
  balanceAfter?: number | null
): CheckinResult & { status: PublicCheckinStatus } {
  return {
    ...result,
    status,
    reward,
    balanceBefore,
    balanceAfter
  };
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBalancePayload(payload: unknown): number | undefined {
  const source = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data?: unknown }).data
    : payload;
  if (!source || typeof source !== 'object') return undefined;

  const record = source as Record<string, unknown>;
  const quota = parseFiniteNumber(record.quota);
  if (quota !== undefined) return quota / 500000;

  const balance = parseFiniteNumber(record.balance);
  if (balance !== undefined) {
    return Math.abs(balance) >= 500000 ? balance / 500000 : balance;
  }

  return undefined;
}

const ACW_ORDER = [
  0xf, 0x23, 0x1d, 0x18, 0x21, 0x10, 0x1, 0x26, 0xa, 0x9,
  0x13, 0x1f, 0x28, 0x1b, 0x16, 0x17, 0x19, 0xd, 0x6, 0xb,
  0x27, 0x12, 0x14, 0x8, 0xe, 0x15, 0x20, 0x1a, 0x2, 0x1e,
  0x7, 0x4, 0x11, 0x5, 0x3, 0x1c, 0x22, 0x25, 0xc, 0x24
];
const ACW_KEY = '3000176000856006061501533003690027800375';

function solveAcwScV2(html: string): string | null {
  const arg1 = html.match(/var\s+arg1=['"]([0-9a-f]{40})['"]/i)?.[1];
  if (!arg1) return null;

  const chars: string[] = [];
  for (let x = 0; x < arg1.length; x += 1) {
    for (let z = 0; z < ACW_ORDER.length; z += 1) {
      if (ACW_ORDER[z] === x + 1) chars[z] = arg1[x];
    }
  }

  const ordered = chars.join('');
  let value = '';
  for (let i = 0; i < ordered.length && i < ACW_KEY.length; i += 2) {
    const left = Number.parseInt(ordered.slice(i, i + 2), 16);
    const right = Number.parseInt(ACW_KEY.slice(i, i + 2), 16);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    value += (left ^ right).toString(16).padStart(2, '0');
  }

  return value || null;
}

function upsertCookieValue(cookie: string, name: string, value: string): string {
  const lowerName = `${name.toLowerCase()}=`;
  const parts = cookie
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith(lowerName));
  parts.push(`${name}=${value}`);
  return parts.join('; ');
}

type RawResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Map<string, string>;
  setCookieHeaders: string[];
  text: string;
};

type AdapterOptions = {
  useProxy?: boolean;
  proxyUrl?: string;
  yesCaptchaClientKey?: string;
};

const proxyAgentCache = new Map<string, ProxyAgent>();

function headerValue(headers: Map<string, string>, key: string): string {
  return headers.get(key.toLowerCase()) || '';
}

function collectSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') return getSetCookie.call(headers) || [];
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function mergeSetCookieValues(cookie: string, setCookieHeaders: string[]): string {
  let merged = cookie;
  for (const raw of setCookieHeaders) {
    const pair = raw.split(';')[0]?.trim();
    if (!pair) continue;
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    merged = upsertCookieValue(merged, pair.slice(0, index).trim(), pair.slice(index + 1));
  }
  return merged;
}

function isTurnstileTokenMissingMessage(message: string): boolean {
  return /turnstile.*(token|response).*(空|缺失|required|missing|empty)|cf-turnstile-response/i.test(message);
}

function appendTurnstileToRequestPath(requestPath: string, token: string): string {
  const url = new URL(requestPath, 'https://public-checkin.local');
  url.searchParams.set('turnstile', token);
  return `${url.pathname}${url.search}`;
}

function withTurnstileRequestBody(body: string | undefined, token: string): string | undefined {
  if (!body) return body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;
    return JSON.stringify({ ...parsed, turnstile: token });
  } catch {
    return body;
  }
}

function getEnvYesCaptchaClientKey(): string {
  return (process.env.YESCAPTCHA_CLIENT_KEY || process.env.YES_CAPTCHA_CLIENT_KEY || '').trim();
}

function getYesCaptchaApiBaseUrl(): string {
  return (process.env.YESCAPTCHA_API_BASE_URL || 'https://api.yescaptcha.com').replace(/\/+$/, '');
}

function getYesCaptchaTimeoutMs(): number {
  const value = Number(process.env.YESCAPTCHA_TIMEOUT_MS || 120_000);
  return Number.isFinite(value) && value > 0 ? value : 120_000;
}

function getYesCaptchaPollIntervalMs(): number {
  const value = Number(process.env.YESCAPTCHA_POLL_INTERVAL_MS || 3_000);
  return Number.isFinite(value) && value > 0 ? value : 3_000;
}

async function postYesCaptchaJson(pathname: string, payload: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`${getYesCaptchaApiBaseUrl()}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`YesCaptcha 返回的内容不是 JSON：${text.slice(0, 120)}`);
  }
  const record = asRecord(parsed);
  if (!response.ok) {
    throw new Error(asString(record.errorDescription || record.message).trim() || `YesCaptcha HTTP ${response.status}`);
  }
  return record;
}

function extractYesCaptchaTurnstileToken(payload: unknown): string {
  const solution = asRecord(asRecord(payload).solution);
  return asString(solution.token || solution.gRecaptchaResponse || solution.g_recaptcha_response).trim();
}

async function solveYesCaptchaTurnstileToken(siteUrl: string, siteKey: string, configuredClientKey = ''): Promise<string> {
  const clientKey = configuredClientKey.trim() || getEnvYesCaptchaClientKey();
  if (!clientKey) {
    throw new Error('YesCaptcha 未配置：请在系统设置的接口鉴权页填写 clientKey，或在环境变量 YESCAPTCHA_CLIENT_KEY 中配置');
  }
  if (!siteKey) {
    throw new Error('站点未返回 Turnstile site key');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getYesCaptchaTimeoutMs());
  try {
    const createPayload: Record<string, unknown> = {
      clientKey,
      task: {
        type: 'TurnstileTaskProxyless',
        websiteURL: normalizeUrl(siteUrl),
        websiteKey: siteKey
      }
    };
    const softId = Number(process.env.YESCAPTCHA_SOFT_ID || 0);
    if (Number.isFinite(softId) && softId > 0) {
      (createPayload.task as Record<string, unknown>).softID = Math.trunc(softId);
    }

    const created = await postYesCaptchaJson('/createTask', createPayload, controller.signal);
    if (Number(created.errorId) !== 0) {
      throw new Error(asString(created.errorDescription || created.errorCode).trim() || 'YesCaptcha 创建 Turnstile 任务失败');
    }
    const taskId = asString(created.taskId).trim();
    if (!taskId) {
      throw new Error('YesCaptcha 未返回 taskId');
    }

    const deadline = Date.now() + getYesCaptchaTimeoutMs();
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, getYesCaptchaPollIntervalMs()));
      const result = await postYesCaptchaJson('/getTaskResult', { clientKey, taskId }, controller.signal);
      if (Number(result.errorId) !== 0) {
        throw new Error(asString(result.errorDescription || result.errorCode).trim() || 'YesCaptcha 获取 Turnstile 结果失败');
      }
      if (result.status === 'ready') {
        const token = extractYesCaptchaTurnstileToken(result);
        if (!token) throw new Error('YesCaptcha 结果中没有 Turnstile token');
        return token;
      }
    }
    throw new Error('YesCaptcha Turnstile 任务超时');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('YesCaptcha Turnstile 请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getProxyDispatcher(proxyUrl: string): Dispatcher {
  const resolved = getProxyUrl(proxyUrl);
  const parsed = new URL(resolved);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('当前仅支持 HTTP/HTTPS 本地代理');
  }
  let agent = proxyAgentCache.get(resolved);
  if (!agent) {
    agent = new ProxyAgent(resolved);
    proxyAgentCache.set(resolved, agent);
  }
  return agent;
}

async function toRawResponse(response: Awaited<ReturnType<typeof fetch>>): Promise<RawResponse> {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: new Map(Array.from(response.headers.entries()).map(([key, value]) => [key.toLowerCase(), value])),
    setCookieHeaders: collectSetCookieHeaders(response.headers),
    text: await response.text()
  };
}

class PublicCheckinAdapter {
  protected readonly siteUrl: string;
  protected readonly useProxy: boolean;
  protected readonly proxyUrl: string;
  protected readonly yesCaptchaClientKey: string;

  constructor(siteUrl: string, options: AdapterOptions = {}) {
    this.siteUrl = normalizeUrl(siteUrl);
    this.useProxy = options.useProxy === true;
    this.proxyUrl = options.proxyUrl?.trim() || '';
    this.yesCaptchaClientKey = options.yesCaptchaClientKey?.trim() || '';
  }

  async login(username: string, password: string): Promise<LoginResult> {
    try {
      const payload = await this.fetchJson<Record<string, unknown>>('/api/user/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const data = asRecord(payload.data);
      const accessToken = typeof payload.data === 'string'
        ? payload.data
        : asString(data.token || data.access_token || payload.token || payload.access_token);
      if (payload.success === true && accessToken.trim()) {
        return { success: true, accessToken: accessToken.trim() };
      }
      return { success: false, errorMessage: this.responseMessage(payload) || '登录失败，未获取到 token' };
    } catch (error) {
      return { success: false, errorMessage: error instanceof Error ? error.message : '登录请求失败' };
    }
  }

  async checkin(credential: PublicCheckinCredential): Promise<CheckinResult> {
    const attempts: Array<{ path: string; body?: string }> = [
      { path: '/api/user/checkin' },
      { path: '/api/user/sign_in', body: '{}' },
      { path: '/api/user/sign', body: '{}' },
      { path: '/api/user/sign' }
    ];
    const errors: string[] = [];

    for (const attempt of attempts) {
      let turnstileToken = '';
      for (let retry = 0; retry < 2; retry += 1) {
        try {
          const requestPath = turnstileToken
            ? appendTurnstileToRequestPath(attempt.path, turnstileToken)
            : attempt.path;
          const payload = await this.fetchJson<Record<string, unknown>>(requestPath, {
            method: 'POST',
            body: turnstileToken ? withTurnstileRequestBody(attempt.body, turnstileToken) : attempt.body,
            headers: this.buildAuthHeaders(credential)
          });
          const message = this.responseMessage(payload) || '签到成功';
          if (payload.success === true || this.isAlreadyCheckedIn(message)) {
            const data = asRecord(payload.data);
            return {
              success: true,
              reward: parsePublicCheckinRewardAmount(data.reward) ?? parsePublicCheckinRewardAmount(payload.data) ?? parsePublicCheckinRewardAmount(message),
              rewardNote: message
            };
          }
          if (!turnstileToken && isTurnstileTokenMissingMessage(message)) {
            turnstileToken = await this.resolveTurnstileToken();
            continue;
          }
          errors.push(message || `${attempt.path} 签到失败`);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : `${attempt.path} 签到请求失败`;
          if (!turnstileToken && isTurnstileTokenMissingMessage(message)) {
            try {
              turnstileToken = await this.resolveTurnstileToken();
              continue;
            } catch (turnstileError) {
              errors.push(turnstileError instanceof Error ? turnstileError.message : 'Turnstile token 获取失败');
              break;
            }
          }
          errors.push(message);
          break;
        }
      }
    }

    return { success: false, errorMessage: this.pickCheckinError(errors) };
  }

  async getBalance(credential: PublicCheckinCredential): Promise<BalanceResult> {
    try {
      const payload = await this.fetchJson<Record<string, unknown>>('/api/user/self', {
        headers: this.buildAuthHeaders(credential)
      });
      const balance = parseBalancePayload(payload);
      if (payload.success !== false && typeof balance === 'number') {
        return { success: true, balance };
      }
      return { success: false, errorMessage: this.responseMessage(payload) || '余额响应中没有可识别的 balance/quota 字段' };
    } catch (error) {
      return { success: false, errorMessage: error instanceof Error ? error.message : '余额请求失败' };
    }
  }

  async getAnnouncements(credential?: PublicCheckinCredential): Promise<NormalizedAnnouncementInput[]> {
    const attempts = ['/api/notice'];
    const errors: string[] = [];

    for (const requestPath of attempts) {
      try {
        const payload = await this.fetchJson<unknown>(requestPath, {
          headers: credential ? this.buildAuthHeaders(credential) : undefined
        });
        return extractAnnouncementsFromNoticePayload(payload);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${requestPath} 获取公告失败`);
      }
    }

    if (errors.length > 0 && errors.every((message) => /HTTP 404|not found|Invalid URL/i.test(message))) {
      return [];
    }

    throw new Error(errors[0] || '获取公告失败');
  }

  protected async fetchJson<T>(requestPath: string, init: RequestInit = {}): Promise<T> {
    const initialHeaders = init.headers as Record<string, string> | undefined;
    let cookie = initialHeaders?.Cookie || initialHeaders?.cookie || '';
    let lastHtmlResponse: RawResponse | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const requestHeaders = cookie
        ? { ...(initialHeaders || {}), Cookie: cookie }
        : initialHeaders;
      const response = await this.requestText(requestPath, { ...init, headers: requestHeaders });
      if (cookie) cookie = mergeSetCookieValues(cookie, response.setCookieHeaders);

      const contentType = headerValue(response.headers, 'content-type');
      const isHtml = response.text.trim().startsWith('<') || contentType.includes('text/html');
      if (!isHtml) return this.parseJsonResponse<T>(response);

      lastHtmlResponse = response;
      if (!cookie) break;
      const nextAcwScV2 = solveAcwScV2(response.text);
      if (!nextAcwScV2) break;
      cookie = upsertCookieValue(cookie, 'acw_sc__v2', nextAcwScV2);
    }

    const response = lastHtmlResponse;
    const text = response?.text || '';
    const title = text.match(/<title>\s*([^<]+)\s*<\/title>/i)?.[1]?.trim();
    const isChallenge = /arg1|acw_sc__v2|cdn_sec_tc|challenge|验证|安全/i.test(text);
    throw new Error(isChallenge
      ? `站点返回了防护挑战页面${title ? `：${title}` : ''}，请确认已启用本地代理并填写完整浏览器 Cookie / 平台用户 ID`
      : `站点返回了 HTML 页面${title ? `：${title}` : ''}，不是 JSON API 响应`);

  }

  private async requestText(requestPath: string, init: RequestInit): Promise<RawResponse> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Encoding': 'identity',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: `${this.siteUrl}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ...(init.headers as Record<string, string> | undefined)
    };
    const body = typeof init.body === 'string' ? init.body : undefined;
    if (body && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    const url = new URL(requestPath, this.siteUrl);
    const requestInit: UndiciRequestInit = {
      method: init.method || 'GET',
      headers,
      body,
      dispatcher: this.useProxy ? getProxyDispatcher(this.proxyUrl) : undefined
    };
    return toRawResponse(await fetch(url, requestInit));
  }

  private parseJsonResponse<T>(response: RawResponse): T {
    return parseJsonResponsePayload<T>(response);
  }

  protected buildAuthHeaders(credential: PublicCheckinCredential): Record<string, string> {
    const userHeaders = this.buildPlatformUserHeaders(credential.platformUserId);
    if (credential.type === 'cookie' && credential.cookie) {
      return {
        Cookie: credential.cookie,
        'X-Requested-With': 'XMLHttpRequest',
        ...userHeaders
      };
    }
    if (credential.accessToken) {
      return {
        Authorization: `Bearer ${credential.accessToken}`,
        ...userHeaders
      };
    }
    return {};
  }

  protected async resolveTurnstileToken(): Promise<string> {
    const status = await this.fetchJson<Record<string, unknown>>('/api/status');
    const data = asRecord(status.data);
    const siteKey = asString(data.turnstile_site_key || data.TurnstileSiteKey).trim();
    const enabled = data.turnstile_check === true || data.TurnstileCheckEnabled === true || Boolean(siteKey);
    if (!enabled) {
      throw new Error('站点要求 Turnstile token，但 /api/status 未启用 Turnstile');
    }
    return solveYesCaptchaTurnstileToken(this.siteUrl, siteKey, this.yesCaptchaClientKey);
  }

  private buildPlatformUserHeaders(platformUserId?: number): Record<string, string> {
    if (!platformUserId || !Number.isFinite(platformUserId)) return {};
    const value = String(Math.trunc(platformUserId));
    return {
      'New-Api-User': value,
      'Veloera-User': value,
      'voapi-user': value,
      'User-id': value,
      'Rix-Api-User': value,
      'neo-api-user': value
    };
  }

  protected responseMessage(payload: unknown): string {
    const record = asRecord(payload);
    for (const key of ['message', 'msg', 'data']) {
      if (typeof record[key] === 'string' && record[key]) return String(record[key]);
    }
    const error = asRecord(record.error);
    if (typeof error.message === 'string') return error.message;
    return '';
  }

  protected isAlreadyCheckedIn(message: string): boolean {
    return /已签到|已经签到|已完成签到|今日.*签|already.*(check|sign)/i.test(message);
  }

  protected pickCheckinError(errors: string[]): string {
    const useful = errors.find((message) => !/Invalid URL|HTTP 404|站点返回了 HTML 页面/i.test(message));
    return useful || errors[0] || '签到失败';
  }
}

class AnyRouterAdapter extends PublicCheckinAdapter {
  protected override buildAuthHeaders(credential: PublicCheckinCredential): Record<string, string> {
    if (credential.type === 'cookie' && credential.cookie) {
      const headers: Record<string, string> = { Cookie: credential.cookie };
      if (credential.platformUserId && Number.isFinite(credential.platformUserId)) {
        headers['New-Api-User'] = String(Math.trunc(credential.platformUserId));
      }
      return headers;
    }
    return super.buildAuthHeaders(credential);
  }
}

class OneHubAdapter extends PublicCheckinAdapter {
  override async checkin(credential: PublicCheckinCredential): Promise<CheckinResult> {
    try {
      const payload = await this.fetchJson<Record<string, unknown>>('/api/user/sign_in', {
        method: 'POST',
        body: '{}',
        headers: this.buildAuthHeaders(credential)
      });
      const message = this.responseMessage(payload) || '签到成功';
      if (payload.success === true || this.isAlreadyCheckedIn(message)) {
        const data = asRecord(payload.data);
        return {
          success: true,
          reward: parsePublicCheckinRewardAmount(data.reward) ?? parsePublicCheckinRewardAmount(payload.data) ?? parsePublicCheckinRewardAmount(message),
          rewardNote: message
        };
      }
      return { success: false, errorMessage: message || '签到失败' };
    } catch {
      return super.checkin(credential);
    }
  }
}

function createAdapter(platform: PublicCheckinPlatform, siteUrl: string, options: AdapterOptions, siteName = ''): PublicCheckinAdapter {
  if (inferPublicCheckinPlatform({ name: siteName, url: siteUrl, platform }) === 'anyrouter') return new AnyRouterAdapter(siteUrl, options);
  if (platform === 'onehub') return new OneHubAdapter(siteUrl, options);
  return new PublicCheckinAdapter(siteUrl, options);
}

function getProxyUrl(configuredProxyUrl = ''): string {
  const proxyUrl = configuredProxyUrl || process.env.SERVER_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  const trimmed = proxyUrl.trim();
  if (!trimmed) {
    throw new Error('已启用本地代理，但系统设置里未配置代理地址');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('本地代理地址格式不正确');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('当前仅支持 HTTP/HTTPS 本地代理');
  }
  return parsed.toString();
}

function parseJsonResponsePayload<T>(response: RawResponse): T {
  let payload: unknown = null;
  try {
    payload = response.text ? JSON.parse(response.text) : null;
  } catch {
    throw new Error(`站点返回的内容不是 JSON：${response.text.slice(0, 120)}`);
  }
  if (!response.ok) {
    const record = asRecord(payload);
    const error = asRecord(record.error);
    const message = asString(record.message || error.message).trim();
    throw new Error(message || `HTTP ${response.status}: ${response.statusText || response.text}`);
  }
  return payload as T;
}

async function assertUniqueSiteUrl(db: D1Database, url: string, allowedSiteId?: number): Promise<void> {
  const rows = await dbAll<{ id: number }>(db, 'SELECT id FROM public_checkin_sites WHERE url = ?', [url]);
  const duplicated = rows.some((row) => Number(row.id) !== allowedSiteId);
  if (duplicated) {
    throw new HTTPException(409, { message: '该站点 URL 已存在，请编辑已有账号或删除重复站点' });
  }
}

async function getAccountWithSite(db: D1Database, accountId: number): Promise<AccountWithSite | null> {
  const row = await dbFirst<JoinedAccountRow>(db, `
    SELECT
      a.id AS account_id,
      a.site_id AS site_id,
      a.label AS label,
      a.credential_type AS credential_type,
      a.credential_data AS credential_data,
      a.api_key_data AS api_key_data,
      a.balance AS balance,
      a.balance_updated_at AS balance_updated_at,
      a.checkin_enabled AS checkin_enabled,
      a.use_proxy AS use_proxy,
      a.status AS status,
      a.last_error AS last_error,
      a.created_at AS account_created_at,
      a.updated_at AS account_updated_at,
      s.name AS site_name,
      s.url AS site_url,
      s.platform AS site_platform,
      s.created_at AS site_created_at,
      s.updated_at AS site_updated_at
    FROM public_checkin_accounts a
    INNER JOIN public_checkin_sites s ON s.id = a.site_id
    WHERE a.id = ?
    LIMIT 1
  `, [accountId]);
  return row ? joinedToAccountWithSite(row) : null;
}

async function getAccountWithSiteForAnnouncement(db: D1Database, accountId: number): Promise<AccountWithSite | null> {
  return getAccountWithSite(db, accountId);
}

async function getAnnouncementUnreadCounts(db: D1Database): Promise<Map<number, number>> {
  const rows = await dbAll<{ site_id: number; count: number }>(db, `
    SELECT site_id, COUNT(*) AS count
    FROM public_checkin_announcements
    WHERE read_at IS NULL
    GROUP BY site_id
  `);
  return new Map(rows.map((row) => [Number(row.site_id), Number(row.count || 0)]));
}

async function listAnnouncementsForSite(db: D1Database, siteId: number): Promise<PublicCheckinAnnouncement[]> {
  const rows = await dbAll<PublicCheckinAnnouncementRow>(db, `
    SELECT
      id,
      site_id,
      source_key,
      title,
      content,
      level,
      source_url,
      first_seen_at,
      last_seen_at,
      read_at
    FROM public_checkin_announcements
    WHERE site_id = ?
    ORDER BY COALESCE(first_seen_at, last_seen_at) DESC, id DESC
  `, [siteId]);
  return rows.map(announcementFromRow);
}

async function listAnnouncementsForAccount(db: D1Database, accountId: number): Promise<PublicCheckinAnnouncement[]> {
  const row = await getAccountWithSiteForAnnouncement(db, accountId);
  if (!row) {
    throw new HTTPException(404, { message: '账号不存在' });
  }
  return listAnnouncementsForSite(db, Number(row.site.id));
}

async function listDailyBalanceBaselinesForDate(
  db: D1Database,
  localDate: string
): Promise<Map<number, PublicCheckinDailyBalanceBaselineRow>> {
  const rows = await dbAll<PublicCheckinDailyBalanceBaselineRow>(db, `
    SELECT
      id,
      account_id,
      local_date,
      baseline_balance,
      captured_at,
      created_at,
      updated_at
    FROM public_checkin_daily_balance_baselines
    WHERE local_date = ?
  `, [localDate]);
  return new Map(rows.map((row) => [Number(row.account_id), row]));
}

async function listTodayRewardTotalsForDate(
  db: D1Database,
  localDate: string,
  timezone: string
): Promise<Map<number, number>> {
  const rows = await dbAll<{ account_id: number; reward: number | null; executed_at: number }>(db, `
    SELECT
      account_id,
      reward,
      executed_at
    FROM public_checkin_logs
    WHERE status = 'success'
      AND reward IS NOT NULL
      AND reward > 0
  `);
  const totals = new Map<number, number>();
  for (const row of rows) {
    const executedAt = Number(row.executed_at);
    if (formatZonedLocalDate(executedAt, timezone) !== localDate) {
      continue;
    }
    const accountId = Number(row.account_id);
    const next = (totals.get(accountId) || 0) + Number(row.reward || 0);
    totals.set(accountId, Math.round(next * 1_000_000) / 1_000_000);
  }
  return totals;
}

async function getTodayRewardTotalForAccount(
  db: D1Database,
  accountId: number,
  localDate: string,
  timezone: string
): Promise<number> {
  const rows = await dbAll<{ reward: number | null; executed_at: number }>(db, `
    SELECT
      reward,
      executed_at
    FROM public_checkin_logs
    WHERE account_id = ?
      AND status = 'success'
      AND reward IS NOT NULL
      AND reward > 0
  `, [accountId]);
  let total = 0;
  for (const row of rows) {
    if (formatZonedLocalDate(Number(row.executed_at), timezone) !== localDate) {
      continue;
    }
    total += Number(row.reward || 0);
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

async function listLatestPositiveRewardsForDate(
  db: D1Database,
  localDate: string,
  timezone: string
): Promise<Map<number, PublicCheckinLatestRewardRow>> {
  const rows = await dbAll<PublicCheckinLatestRewardRow>(db, `
    SELECT
      account_id,
      reward,
      executed_at
    FROM public_checkin_logs
    WHERE status = 'success'
      AND reward IS NOT NULL
      AND reward > 0
    ORDER BY executed_at DESC, id DESC
  `);

  const map = new Map<number, PublicCheckinLatestRewardRow>();
  for (const row of rows) {
    if (formatZonedLocalDate(Number(row.executed_at), timezone) !== localDate) {
      continue;
    }
    const accountId = Number(row.account_id);
    if (!map.has(accountId)) {
      map.set(accountId, {
        account_id: accountId,
        reward: row.reward == null ? null : Number(row.reward),
        executed_at: Number(row.executed_at)
      });
    }
  }
  return map;
}

async function upsertDailyBalanceBaseline(
  db: D1Database,
  accountId: number,
  localDate: string,
  baselineBalance: number,
  capturedAt: number
): Promise<void> {
  await dbRun(db, `
    INSERT INTO public_checkin_daily_balance_baselines (
      account_id,
      local_date,
      baseline_balance,
      captured_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, local_date) DO UPDATE SET
      baseline_balance = excluded.baseline_balance,
      captured_at = excluded.captured_at,
      updated_at = excluded.updated_at
  `, [accountId, localDate, baselineBalance, capturedAt, capturedAt, capturedAt]);
}

async function insertDailyBalanceBaselineIfMissing(
  db: D1Database,
  accountId: number,
  localDate: string,
  baselineBalance: number,
  capturedAt: number
): Promise<void> {
  await dbRun(db, `
    INSERT INTO public_checkin_daily_balance_baselines (
      account_id,
      local_date,
      baseline_balance,
      captured_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, local_date) DO NOTHING
  `, [accountId, localDate, baselineBalance, capturedAt, capturedAt, capturedAt]);
}

async function captureDailyBalanceBaselines(db: D1Database, timezone: string): Promise<void> {
  const accounts = await listAccounts(db);
  const now = unixNow();
  const localDate = formatZonedLocalDate(now, timezone);

  for (const account of accounts) {
    if (account.status === 'disabled') {
      continue;
    }
    const result = await refreshBalanceForAccount(db, account.id, {
      baselineMode: 'capture',
      timezone,
      localDate
    });
    if (!result.success || typeof result.balance !== 'number') {
      console.warn(`[PublicCheckin] 余额基线采集失败: accountId=${account.id}`, result.errorMessage || '未知原因');
    }
  }
}

function resolveDailyBalanceDisplayState(input: {
  baselineBalance: number | null;
  currentBalance: number | null;
  balanceUpdatedAt: number | null;
  todayRewardTotal: number;
  latestPositiveReward: PublicCheckinLatestRewardRow | null;
}): { mode: PublicCheckinDailyBalanceDisplayMode; amount: number | null } {
  const {
    baselineBalance,
    currentBalance,
    balanceUpdatedAt,
    todayRewardTotal,
    latestPositiveReward
  } = input;

  if (baselineBalance == null || currentBalance == null || balanceUpdatedAt == null) {
    return { mode: 'none', amount: null };
  }

  const computedUsage = Math.max(0, baselineBalance + todayRewardTotal - currentBalance);
  const todayUsed = Number.isFinite(computedUsage)
    ? Math.round(computedUsage * 1_000_000) / 1_000_000
    : 0;

  if (
    latestPositiveReward
    && typeof latestPositiveReward.reward === 'number'
    && latestPositiveReward.reward > 0
    && balanceUpdatedAt <= latestPositiveReward.executed_at
  ) {
    return { mode: 'reward', amount: latestPositiveReward.reward };
  }

  if (todayUsed > 0) {
    return { mode: 'usage', amount: todayUsed };
  }

  if (
    latestPositiveReward
    && typeof latestPositiveReward.reward === 'number'
    && latestPositiveReward.reward > 0
  ) {
    return { mode: 'reward', amount: latestPositiveReward.reward };
  }

  return { mode: 'none', amount: null };
}

async function markAnnouncementsReadForSite(db: D1Database, siteId: number): Promise<void> {
  await dbRun(db, `
    UPDATE public_checkin_announcements
    SET read_at = ?
    WHERE site_id = ? AND read_at IS NULL
  `, [unixNow(), siteId]);
}

function normalizeAnnouncementPollingInterval(value: unknown): 15 | 30 | 60 {
  const parsed = Number(value);
  if (ANNOUNCEMENT_POLLING_INTERVALS.includes(parsed as 15 | 30 | 60)) {
    return parsed as 15 | 30 | 60;
  }
  throw new HTTPException(400, { message: '公告轮询频率仅支持 15 / 30 / 60 分钟' });
}

async function ensureSite(db: D1Database, input: ReturnType<typeof validateAccountInput>, currentAccountId?: number): Promise<number> {
  if (input.siteId) return input.siteId;
  if (!input.site) throw new HTTPException(400, { message: '缺少站点信息' });

  if (currentAccountId) {
    const current = await getAccountWithSite(db, currentAccountId);
    if (!current) throw new HTTPException(404, { message: '账号不存在' });
    await assertUniqueSiteUrl(db, input.site.url, current.site.id);
    await dbRun(db, `
      UPDATE public_checkin_sites
      SET name = ?, url = ?, platform = ?, updated_at = ?
      WHERE id = ?
    `, [input.site.name, input.site.url, input.site.platform, unixNow(), current.site.id]);
    return current.site.id;
  }

  await assertUniqueSiteUrl(db, input.site.url);
  const result = await dbRun(db, `
    INSERT INTO public_checkin_sites (name, url, platform, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `, [input.site.name, input.site.url, input.site.platform, unixNow(), unixNow()]);
  return Number(result.meta.last_row_id);
}

async function resolveAccountLabel(db: D1Database, input: ReturnType<typeof validateAccountInput>, siteId: number): Promise<string> {
  if (input.label.trim()) return input.label.trim();
  if (input.site?.name.trim()) return input.site.name.trim();
  const site = await dbFirst<{ name: string }>(db, 'SELECT name FROM public_checkin_sites WHERE id = ?', [siteId]);
  if (!site) throw new HTTPException(404, { message: '站点不存在' });
  return site.name;
}

async function listAccounts(db: D1Database): Promise<PublicCheckinAccount[]> {
  const rows = await dbAll<JoinedAccountRow>(db, `
    SELECT
      a.id AS account_id,
      a.site_id AS site_id,
      a.label AS label,
      a.credential_type AS credential_type,
      a.credential_data AS credential_data,
      a.api_key_data AS api_key_data,
      a.balance AS balance,
      a.balance_updated_at AS balance_updated_at,
      a.checkin_enabled AS checkin_enabled,
      a.use_proxy AS use_proxy,
      a.status AS status,
      a.last_error AS last_error,
      a.created_at AS account_created_at,
      a.updated_at AS account_updated_at,
      s.name AS site_name,
      s.url AS site_url,
      s.platform AS site_platform,
      s.created_at AS site_created_at,
      s.updated_at AS site_updated_at
    FROM public_checkin_accounts a
    INNER JOIN public_checkin_sites s ON s.id = a.site_id
    ORDER BY COALESCE(a.created_at, a.id) ASC, a.id ASC
  `);
  const unreadCounts = await getAnnouncementUnreadCounts(db);
  const settings = await getSettings(db);
  const now = unixNow();
  const localDate = formatZonedLocalDate(now, settings.timezone);
  const [baselines, todayRewardTotals, latestPositiveRewards] = await Promise.all([
    listDailyBalanceBaselinesForDate(db, localDate),
    listTodayRewardTotalsForDate(db, localDate, settings.timezone),
    listLatestPositiveRewardsForDate(db, localDate, settings.timezone)
  ]);

  return rows.map((row) => {
    const { account, site } = joinedToAccountWithSite(row);
    const accountId = Number(account.id);
    const baseline = baselines.get(accountId);
    const displayState = resolveDailyBalanceDisplayState({
      baselineBalance: baseline ? Number(baseline.baseline_balance) : null,
      currentBalance: account.balance == null ? null : Number(account.balance),
      balanceUpdatedAt: account.balance_updated_at == null ? null : Number(account.balance_updated_at),
      todayRewardTotal: todayRewardTotals.get(accountId) ?? 0,
      latestPositiveReward: latestPositiveRewards.get(accountId) ?? null
    });
    return toSafeAccount(
      account,
      site,
      displayState,
      unreadCounts.get(Number(site.id)) ?? 0
    );
  });
}

async function createAccount(db: D1Database, body: unknown): Promise<PublicCheckinAccount> {
  const input = validateAccountInput(body, true);
  const siteId = await ensureSite(db, input);
  const label = await resolveAccountLabel(db, input, siteId);
  const now = unixNow();
  const result = await dbRun(db, `
    INSERT INTO public_checkin_accounts (
      site_id, label, credential_type, credential_data, api_key_data, checkin_enabled, use_proxy, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    siteId,
    label,
    input.credentialType,
    encryptCredential(JSON.stringify(input.credential)),
    input.apiKey ? encryptCredential(input.apiKey) : null,
    input.checkinEnabled ? 1 : 0,
    input.useProxy ? 1 : 0,
    input.status || 'active',
    now,
    now
  ]);
  const created = await getAccountWithSite(db, Number(result.meta.last_row_id));
  if (!created) throw new HTTPException(500, { message: '账号创建失败' });
  return toSafeAccount(created.account, created.site);
}

async function updateAccount(db: D1Database, accountId: number, body: unknown): Promise<PublicCheckinAccount> {
  const current = await getAccountWithSite(db, accountId);
  if (!current) throw new HTTPException(404, { message: '账号不存在' });
  const input = validateAccountInput(body, false);
  const siteId = await ensureSite(db, input, accountId);
  const label = await resolveAccountLabel(db, input, siteId);
  const now = unixNow();

  if (input.credential) {
    await dbRun(db, `
      UPDATE public_checkin_accounts
      SET site_id = ?, label = ?, credential_type = ?, credential_data = ?, api_key_data = COALESCE(?, api_key_data), checkin_enabled = ?, use_proxy = ?, status = ?, updated_at = ?
      WHERE id = ?
    `, [
      siteId,
      label,
      input.credentialType,
      encryptCredential(JSON.stringify(input.credential)),
      input.apiKey ? encryptCredential(input.apiKey) : null,
      input.checkinEnabled ? 1 : 0,
      input.useProxy ? 1 : 0,
      input.status || current.account.status,
      now,
      accountId
    ]);
  } else {
    await dbRun(db, `
      UPDATE public_checkin_accounts
      SET site_id = ?, label = ?, credential_type = ?, api_key_data = COALESCE(?, api_key_data), checkin_enabled = ?, use_proxy = ?, status = ?, updated_at = ?
      WHERE id = ?
    `, [
      siteId,
      label,
      input.credentialType,
      input.apiKey ? encryptCredential(input.apiKey) : null,
      input.checkinEnabled ? 1 : 0,
      input.useProxy ? 1 : 0,
      input.status || current.account.status,
      now,
      accountId
    ]);
  }

  const updated = await getAccountWithSite(db, accountId);
  if (!updated) throw new HTTPException(500, { message: '账号更新失败' });
  return toSafeAccount(updated.account, updated.site);
}

async function setAccountError(db: D1Database, accountId: number, error: string | null, status?: PublicCheckinAccountStatus): Promise<void> {
  await dbRun(db, `
    UPDATE public_checkin_accounts
    SET last_error = ?, status = COALESCE(?, status), updated_at = ?
    WHERE id = ?
  `, [error, status ?? null, unixNow(), accountId]);
}

async function updateCredential(db: D1Database, accountId: number, credential: PublicCheckinCredential, type?: PublicCheckinCredentialType): Promise<void> {
  await dbRun(db, `
    UPDATE public_checkin_accounts
    SET credential_type = ?, credential_data = ?, updated_at = ?
    WHERE id = ?
  `, [type || credential.type, encryptCredential(JSON.stringify(credential)), unixNow(), accountId]);
}

function buildOpenAiCompatibleUrl(baseUrl: string, requestPath: string): string {
  const normalized = normalizeUrl(baseUrl);
  const suffix = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  return `${normalized}${suffix}`;
}

function extractModelIds(payload: unknown): string[] {
  const record = asRecord(payload);
  const rawItems = Array.isArray(record.data) ? record.data : Array.isArray(payload) ? payload : [];
  const ids = rawItems
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      return asString(asRecord(item).id).trim();
    })
    .filter(Boolean);
  return Array.from(new Set(ids));
}

const publicCheckinModelNameCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base'
});

function rankPublicCheckinModelVendor(model: string): number {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith('gpt-')) return 0;
  if (normalized.startsWith('claude-')) return 1;
  if (normalized.startsWith('gemini-')) return 2;
  if (normalized.startsWith('deepseek-')) return 3;
  return 4;
}

function sortPublicCheckinModelIds(models: string[]): string[] {
  return [...models].sort((left, right) => {
    const rankDiff = rankPublicCheckinModelVendor(left) - rankPublicCheckinModelVendor(right);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return publicCheckinModelNameCollator.compare(left, right);
  });
}

function buildPublicCheckinModelProbeResponse(
  accountId: number,
  siteName: string,
  payload: unknown
): PublicCheckinModelProbeResponse {
  const sortedModels = sortPublicCheckinModelIds(extractModelIds(payload));
  return {
    accountId,
    siteName,
    items: sortedModels.map((model) => ({ model }))
  };
}

function extractOpenAiResponseText(payload: unknown): string {
  const record = asRecord(payload);
  const topLevel = asString(record.output_text).trim();
  if (topLevel) {
    return topLevel;
  }

  const outputs = Array.isArray(record.output) ? record.output : [];
  for (const output of outputs) {
    const outputRecord = asRecord(output);
    const contents = Array.isArray(outputRecord.content) ? outputRecord.content : [];
    for (const content of contents) {
      const contentRecord = asRecord(content);
      const text = asString(contentRecord.text).trim();
      if (text) {
        return text;
      }
      const nestedText = asString(asRecord(contentRecord.text).value).trim();
      if (nestedText) {
        return nestedText;
      }
    }
  }

  return '';
}

function normalizeOpenAiCompatibleErrorMessage(response: RawResponse): string {
  const jsonMessage = (() => {
    try {
      const payload = response.text ? JSON.parse(response.text) : null;
      const record = asRecord(payload);
      const error = asRecord(record.error);
      return asString(record.message || error.message).trim();
    } catch {
      return '';
    }
  })();
  if (jsonMessage) {
    return jsonMessage;
  }

  const rawText = response.text.trim();
  if (rawText) {
    return rawText.slice(0, 300);
  }

  return `HTTP ${response.status}: ${response.statusText || 'Request Failed'}`;
}

async function requestOpenAiCompatibleRaw(
  siteUrl: string,
  apiKey: string,
  requestPath: string,
  init: RequestInit,
  useProxy: boolean,
  proxyUrl: string
): Promise<RawResponse> {
  const requestInit: UndiciRequestInit = {
    method: init.method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers as Record<string, string> | undefined)
    },
    body: init.body === null ? undefined : (init.body as UndiciRequestInit['body']),
    dispatcher: useProxy ? getProxyDispatcher(proxyUrl) : undefined,
    signal: init.signal as AbortSignal | undefined
  };

  if (openAiCompatibleFetchOverride) {
    return openAiCompatibleFetchOverride(buildOpenAiCompatibleUrl(siteUrl, requestPath), requestInit);
  }

  const response = await fetch(buildOpenAiCompatibleUrl(siteUrl, requestPath), {
    ...requestInit
  });
  return toRawResponse(response);
}

async function requestOpenAiCompatibleJson(
  siteUrl: string,
  apiKey: string,
  requestPath: string,
  init: RequestInit,
  useProxy: boolean,
  proxyUrl: string
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await requestOpenAiCompatibleRaw(siteUrl, apiKey, requestPath, {
      ...init,
      signal: controller.signal
    }, useProxy, proxyUrl);
    return parseJsonResponsePayload<unknown>(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeOpenAiCompatibleModel(
  siteUrl: string,
  apiKey: string,
  model: string,
  useProxy: boolean,
  proxyUrl: string
): Promise<{ success: true; responseText: string } | { success: false; errorMessage: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await requestOpenAiCompatibleRaw(siteUrl, apiKey, '/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: 'Hi',
        max_output_tokens: 32
      }),
      signal: controller.signal
    }, useProxy, proxyUrl);

    if (!response.ok) {
      return {
        success: false,
        errorMessage: normalizeOpenAiCompatibleErrorMessage(response)
      };
    }

    let payload: unknown = null;
    try {
      payload = response.text ? JSON.parse(response.text) : null;
    } catch {
      return {
        success: false,
        errorMessage: `站点返回的内容不是 JSON：${response.text.slice(0, 120)}`
      };
    }

    const responseText = extractOpenAiResponseText(payload);
    if (!responseText) {
      return {
        success: false,
        errorMessage: '接口返回成功，但没有可识别的文本回复'
      };
    }

    return {
      success: true,
      responseText
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, errorMessage: '请求超时' };
    }
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : '请求失败'
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function getPublicCheckinModelCacheTtlMs(): number {
  const raw = Number(process.env.PUBLIC_CHECKIN_MODEL_CACHE_TTL_MS || DEFAULT_PUBLIC_CHECKIN_MODEL_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_PUBLIC_CHECKIN_MODEL_CACHE_TTL_MS;
}

function buildPublicCheckinModelCacheKey(input: {
  accountId: number;
  siteUrl: string;
  apiKey: string;
  useProxy: boolean;
  proxyUrl: string;
}): string {
  return JSON.stringify({
    accountId: input.accountId,
    siteUrl: normalizeUrl(input.siteUrl),
    apiKey: input.apiKey,
    useProxy: input.useProxy,
    proxyUrl: input.useProxy ? getProxyUrl(input.proxyUrl) : ''
  });
}

function clonePublicCheckinModelProbeResponse(
  response: PublicCheckinModelProbeResponse
): PublicCheckinModelProbeResponse {
  return {
    accountId: response.accountId,
    siteName: response.siteName,
    items: response.items.map((item) => ({ model: item.model }))
  };
}

function getCachedPublicCheckinModelProbeResponse(
  cacheKey: string,
  now = Date.now()
): PublicCheckinModelProbeResponse | null {
  const cached = publicCheckinModelCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= now) {
    publicCheckinModelCache.delete(cacheKey);
    return null;
  }
  return clonePublicCheckinModelProbeResponse(cached.response);
}

function setCachedPublicCheckinModelProbeResponse(
  cacheKey: string,
  response: PublicCheckinModelProbeResponse
): void {
  const ttlMs = getPublicCheckinModelCacheTtlMs();
  if (ttlMs <= 0) {
    return;
  }
  publicCheckinModelCache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    response: clonePublicCheckinModelProbeResponse(response)
  });
}

async function requireModelApiKey(db: D1Database, accountId: number): Promise<{ row: AccountWithSite; apiKey: string; proxyUrl: string }> {
  const row = await getAccountWithSite(db, accountId);
  if (!row) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  const apiKey = decryptAccountApiKey(row.account);
  if (!apiKey) {
    throw new HTTPException(400, { message: '请先在编辑账号中配置 API Key' });
  }

  const proxyUrl = row.account.use_proxy === 1 ? await getSystemProxyUrl(db) : '';
  return { row, apiKey, proxyUrl };
}

async function resolveCredential(db: D1Database, accountId: number): Promise<AccountWithSite & { credential: PublicCheckinCredential }> {
  const row = await getAccountWithSite(db, accountId);
  if (!row) throw new HTTPException(404, { message: '账号不存在' });
  const credential = decryptAccountCredential(row.account);
  if (credential.type !== 'password') return { ...row, credential };

  const adapter = await createAdapterForAccount(db, row.site.platform, row.site.url, row.account.use_proxy === 1, row.site.name);
  const login = await adapter.login(credential.username || '', credential.password || '');
  if (!login.success || !login.accessToken) {
    throw new Error(login.errorMessage || '密码登录失败');
  }
  const nextCredential: PublicCheckinCredential = { type: 'access_token', accessToken: login.accessToken };
  await updateCredential(db, accountId, nextCredential, 'access_token');
  return { ...row, credential: nextCredential };
}

async function refreshBalanceForAccount(
  db: D1Database,
  accountId: number,
  options: {
    baselineMode?: 'none' | 'capture' | 'recover';
    timezone?: string;
    localDate?: string;
  } = {}
): Promise<BalanceResult> {
  let resolved: Awaited<ReturnType<typeof resolveCredential>>;
  try {
    resolved = await resolveCredential(db, accountId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '余额刷新失败';
    await setAccountError(db, accountId, errorMessage, 'error');
    return { success: false, errorMessage };
  }

  const adapter = await createAdapterForAccount(db, resolved.site.platform, resolved.site.url, resolved.account.use_proxy === 1, resolved.site.name);
  const result: BalanceResult = await adapter.getBalance(resolved.credential).catch((error) => ({
    success: false,
    errorMessage: error instanceof Error ? error.message : '余额刷新失败'
  }));
  const now = unixNow();
  if (result.success && typeof result.balance === 'number') {
    const baselineMode = options.baselineMode ?? 'recover';
    await dbRun(db, `
      UPDATE public_checkin_accounts
      SET balance = ?, balance_updated_at = ?, last_error = NULL, status = 'active', updated_at = ?
      WHERE id = ?
    `, [result.balance, now, now, accountId]);
    if (baselineMode === 'capture') {
      const timezone = options.timezone ?? (await getSettings(db)).timezone;
      const localDate = options.localDate ?? formatZonedLocalDate(now, timezone);
      await upsertDailyBalanceBaseline(db, accountId, localDate, result.balance, now);
    } else if (baselineMode === 'recover') {
      const timezone = options.timezone ?? (await getSettings(db)).timezone;
      const localDate = options.localDate ?? formatZonedLocalDate(now, timezone);
      const todayRewardTotal = await getTodayRewardTotalForAccount(db, accountId, localDate, timezone);
      const recoveredBaseline = Math.round((result.balance - todayRewardTotal) * 1_000_000) / 1_000_000;
      await insertDailyBalanceBaselineIfMissing(db, accountId, localDate, recoveredBaseline, now);
    }
    return result;
  }

  await setAccountError(db, accountId, result.errorMessage || '余额刷新失败', 'error');
  return result;
}

async function refreshBalanceAll(db: D1Database): Promise<Array<{ accountId: number; success: boolean; balance?: number; errorMessage?: string }>> {
  const accounts = await listAccounts(db);
  const results = [];
  for (const account of accounts) {
    if (account.status === 'disabled') {
      results.push({ accountId: account.id, success: false, errorMessage: '账号已禁用' });
      continue;
    }
    const result = await refreshBalanceForAccount(db, account.id);
    results.push({ accountId: account.id, ...result });
  }
  return results;
}

async function insertCheckinLog(db: D1Database, input: {
  accountId: number;
  triggeredBy: PublicCheckinTriggeredBy;
  status: PublicCheckinStatus;
  reward?: number | null;
  rewardNote?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await dbRun(db, `
    INSERT INTO public_checkin_logs (account_id, triggered_by, status, reward, reward_note, error_message, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    input.accountId,
    input.triggeredBy,
    input.status,
    input.reward ?? null,
    input.rewardNote ?? null,
    input.errorMessage ?? null,
    unixNow()
  ]);
}

async function executeCheckin(db: D1Database, accountId: number, triggeredBy: PublicCheckinTriggeredBy): Promise<CheckinResult & { status: PublicCheckinStatus }> {
  const row = await getAccountWithSite(db, accountId);
  if (!row) return { success: false, status: 'failed', errorMessage: '账号不存在' };

  if (row.account.status === 'disabled' || row.account.checkin_enabled !== 1) {
    const errorMessage = row.account.status === 'disabled' ? '账号已禁用' : '账号未启用自动签到';
    await insertCheckinLog(db, { accountId, triggeredBy, status: 'skipped', errorMessage });
    return { success: true, status: 'skipped', errorMessage: '账号已跳过' };
  }

  let credential = decryptAccountCredential(row.account);
  const adapter = await createAdapterForAccount(db, row.site.platform, row.site.url, row.account.use_proxy === 1, row.site.name);
  if (credential.type === 'password') {
    const login = await adapter.login(credential.username || '', credential.password || '');
    if (!login.success || !login.accessToken) {
      const errorMessage = login.errorMessage || '密码登录失败';
      await insertCheckinLog(db, { accountId, triggeredBy, status: 'failed', errorMessage });
      await setAccountError(db, accountId, errorMessage, 'error');
      return { success: false, status: 'failed', errorMessage };
    }
    credential = { type: 'access_token', accessToken: login.accessToken };
    await updateCredential(db, accountId, credential, 'access_token');
  }

  const result = await adapter.checkin(credential);
  const status: PublicCheckinStatus = result.success ? 'success' : 'failed';
  let reward = result.reward ?? null;
  const balanceBefore = row.account.balance == null ? null : Number(row.account.balance);
  let balanceAfter: number | null = null;

  if (result.success) {
    await setAccountError(db, accountId, null, 'active');
    try {
      const balanceResult = await refreshBalanceForAccount(db, accountId);
      if (balanceResult.success && typeof balanceResult.balance === 'number' && Number.isFinite(balanceResult.balance)) {
        balanceAfter = balanceResult.balance;
      }
      if (reward == null && balanceResult.success) {
        reward = inferPublicCheckinRewardFromBalanceDelta(balanceBefore, balanceResult.balance);
      }
    } catch {}
    await insertCheckinLog(db, {
      accountId,
      triggeredBy,
      status,
      reward,
      rewardNote: result.rewardNote ?? null,
      errorMessage: result.errorMessage ?? null
    });
  } else {
    await insertCheckinLog(db, {
      accountId,
      triggeredBy,
      status,
      reward,
      rewardNote: result.rewardNote ?? null,
      errorMessage: result.errorMessage ?? null
    });
    await setAccountError(db, accountId, result.errorMessage || '签到失败', 'error');
  }

  return result.success
    ? buildCheckinResultForNotification(result, status, reward, balanceBefore, balanceAfter)
    : buildCheckinResultForNotification(result, status, reward);
}

async function withAccountMutex<T>(key: string, locked: () => Promise<T>, task: () => Promise<T>): Promise<T> {
  if (runningTasks.has(key)) return locked();
  runningTasks.add(key);
  try {
    return await task();
  } finally {
    runningTasks.delete(key);
  }
}

async function runCheckinForAccount(db: D1Database, accountId: number, triggeredBy: PublicCheckinTriggeredBy): Promise<CheckinResult & { status: PublicCheckinStatus }> {
  return withAccountMutex<CheckinResult & { status: PublicCheckinStatus }>(
    `public-checkin:${accountId}`,
    async () => {
      await insertCheckinLog(db, {
        accountId,
        triggeredBy,
        status: 'skipped',
        errorMessage: '已有签到任务在进行中'
      });
      return { success: true, status: 'skipped' as const, errorMessage: '已有签到任务在进行中' };
    },
    () => executeCheckin(db, accountId, triggeredBy)
  );
}

async function runCheckinAll(db: D1Database, triggeredBy: PublicCheckinTriggeredBy) {
  const rows = await dbAll<JoinedAccountRow>(db, `
    SELECT
      a.id AS account_id,
      a.site_id AS site_id,
      a.label AS label,
      a.credential_type AS credential_type,
      a.credential_data AS credential_data,
      a.balance AS balance,
      a.balance_updated_at AS balance_updated_at,
      a.checkin_enabled AS checkin_enabled,
      a.use_proxy AS use_proxy,
      a.status AS status,
      a.last_error AS last_error,
      a.created_at AS account_created_at,
      a.updated_at AS account_updated_at,
      s.name AS site_name,
      s.url AS site_url,
      s.platform AS site_platform,
      s.created_at AS site_created_at,
      s.updated_at AS site_updated_at
    FROM public_checkin_accounts a
    INNER JOIN public_checkin_sites s ON s.id = a.site_id
    WHERE a.checkin_enabled = 1 AND a.status <> 'disabled'
    ORDER BY COALESCE(a.created_at, a.id) ASC, a.id ASC
  `);
  const results = [];
  for (const row of rows) {
    results.push({
      accountId: Number(row.account_id),
      label: row.label,
      siteName: row.site_name,
      result: await runCheckinForAccount(db, Number(row.account_id), triggeredBy)
    });
  }
  return results;
}

async function testAccountConnection(db: D1Database, body: unknown): Promise<BalanceResult> {
  const input = validateAccountInput(body, true);
  const site = input.siteId
    ? await dbFirst<SiteRow>(db, 'SELECT * FROM public_checkin_sites WHERE id = ?', [input.siteId])
    : input.site;
  if (!site) throw new HTTPException(404, { message: '站点不存在' });

  let credential = input.credential!;
  const adapter = await createAdapterForAccount(db, site.platform, site.url, input.useProxy, site.name);
  if (credential.type === 'password') {
    const login = await adapter.login(credential.username || '', credential.password || '');
    if (!login.success || !login.accessToken) {
      return { success: false, errorMessage: login.errorMessage || '密码登录失败' };
    }
    credential = { type: 'access_token', accessToken: login.accessToken };
  }

  const result = await adapter.getBalance(credential);
  if (result.success) return result;
  return {
    success: false,
    errorMessage: `${result.errorMessage || '连接检测失败'}${describeCookieDiagnostics(credential, input.useProxy)}`
  };
}

async function testAccountModels(db: D1Database, accountId: number): Promise<PublicCheckinModelProbeResponse> {
  const { row, apiKey, proxyUrl } = await requireModelApiKey(db, accountId);
  const cacheKey = buildPublicCheckinModelCacheKey({
    accountId,
    siteUrl: row.site.url,
    apiKey,
    useProxy: row.account.use_proxy === 1,
    proxyUrl
  });
  const cached = getCachedPublicCheckinModelProbeResponse(cacheKey);
  if (cached) {
    return cached;
  }

  const runningRequest = publicCheckinModelRequests.get(cacheKey);
  if (runningRequest) {
    return clonePublicCheckinModelProbeResponse(await runningRequest);
  }

  const request = (async (): Promise<PublicCheckinModelProbeResponse> => {
    const payload = await requestOpenAiCompatibleJson(
      row.site.url,
      apiKey,
      '/v1/models',
      { method: 'GET' },
      row.account.use_proxy === 1,
      proxyUrl
    );

    const response = buildPublicCheckinModelProbeResponse(
      accountId,
      row.site.name,
      payload
    );
    if (response.items.length > 0) {
      setCachedPublicCheckinModelProbeResponse(cacheKey, response);
    }
    return response;
  })();

  publicCheckinModelRequests.set(cacheKey, request);
  try {
    return clonePublicCheckinModelProbeResponse(await request);
  } finally {
    publicCheckinModelRequests.delete(cacheKey);
  }
}

function readModelProbeInput(body: unknown): { model: string } {
  const model = asString(asRecord(body).model).trim();
  if (!model) {
    throw new HTTPException(400, { message: '模型名称不能为空' });
  }
  return { model };
}

async function probeAccountModel(
  db: D1Database,
  accountId: number,
  body: unknown
): Promise<PublicCheckinSingleModelProbeResponse> {
  const { row, apiKey, proxyUrl } = await requireModelApiKey(db, accountId);
  const { model } = readModelProbeInput(body);
  const startedAt = Date.now();
  const checkedAt = unixNow();
  const result = await probeOpenAiCompatibleModel(
    row.site.url,
    apiKey,
    model,
    row.account.use_proxy === 1,
    proxyUrl
  );

  return {
    accountId,
    siteName: row.site.name,
    model,
    success: result.success,
    prompt: 'Hi',
    responseText: result.success ? result.responseText : null,
    errorMessage: result.success ? null : result.errorMessage,
    latencyMs: Math.max(1, Date.now() - startedAt),
    checkedAt
  };
}

function describeCookieDiagnostics(credential: PublicCheckinCredential, useProxy: boolean): string {
  if (credential.type !== 'cookie') return '';
  const cookie = credential.cookie || '';
  const has = (name: string) => new RegExp(`(?:^|;\\s*)${name}=`, 'i').test(cookie);
  const hasAllChallengeCookies = has('session') && has('acw_tc') && has('cdn_sec_tc') && has('acw_sc__v2');
  const items = [
    `session:${has('session') ? '有' : '缺失'}`,
    `acw_tc:${has('acw_tc') ? '有' : '缺失'}`,
    `cdn_sec_tc:${has('cdn_sec_tc') ? '有' : '缺失'}`,
    `acw_sc__v2:${has('acw_sc__v2') ? '有' : '缺失'}`,
    `平台用户ID:${credential.platformUserId || '未填'}`,
    `本地代理:${useProxy ? '启用' : '未启用'}`
  ];
  const hint = hasAllChallengeCookies && credential.platformUserId && useProxy
    ? '。判断：关键 Cookie、平台用户 ID 和本地代理都已生效，仍返回防护页通常表示 acw_sc__v2 已过期，或 Cookie 是在不同出口 IP/代理下生成的'
    : '';
  return `。Cookie诊断：${items.join('，')}${hint}`;
}

async function resolveAnnouncementFetchTarget(db: D1Database, siteId: number): Promise<AccountWithSite | null> {
  const row = await dbFirst<JoinedAccountRow>(db, `
    SELECT
      a.id AS account_id,
      a.site_id AS site_id,
      a.label AS label,
      a.credential_type AS credential_type,
      a.credential_data AS credential_data,
      a.api_key_data AS api_key_data,
      a.balance AS balance,
      a.balance_updated_at AS balance_updated_at,
      a.checkin_enabled AS checkin_enabled,
      a.use_proxy AS use_proxy,
      a.status AS status,
      a.last_error AS last_error,
      a.created_at AS account_created_at,
      a.updated_at AS account_updated_at,
      s.name AS site_name,
      s.url AS site_url,
      s.platform AS site_platform,
      s.created_at AS site_created_at,
      s.updated_at AS site_updated_at
    FROM public_checkin_accounts a
    INNER JOIN public_checkin_sites s ON s.id = a.site_id
    WHERE a.site_id = ?
    ORDER BY
      CASE a.status
        WHEN 'active' THEN 0
        WHEN 'error' THEN 1
        ELSE 2
      END ASC,
      COALESCE(a.updated_at, a.id) DESC,
      a.id DESC
    LIMIT 1
  `, [siteId]);

  return row ? joinedToAccountWithSite(row) : null;
}

async function fetchAnnouncementsForSite(db: D1Database, siteId: number): Promise<{ site: SiteRow; items: NormalizedAnnouncementInput[] }> {
  const target = await resolveAnnouncementFetchTarget(db, siteId);
  if (!target) {
    throw new HTTPException(404, { message: '站点不存在或没有可用账号' });
  }

  const adapter = await createAdapterForAccount(
    db,
    target.site.platform,
    target.site.url,
    target.account.use_proxy === 1,
    target.site.name
  );

  let anonymousError: unknown = null;
  try {
    const anonymousItems = await adapter.getAnnouncements();
    if (anonymousItems.length > 0) {
      return { site: target.site, items: anonymousItems };
    }

    const credential = target.account.credential_data
      ? await resolveCredential(db, Number(target.account.id)).then((row) => row.credential).catch(() => null)
      : null;
    if (credential) {
      return {
        site: target.site,
        items: await adapter.getAnnouncements(credential)
      };
    }

    return { site: target.site, items: anonymousItems };
  } catch (error) {
    anonymousError = error;
  }

  if (target.account.credential_data) {
    const credential = await resolveCredential(db, Number(target.account.id)).then((row) => row.credential).catch(() => null);
    if (credential) {
      return {
        site: target.site,
        items: await adapter.getAnnouncements(credential)
      };
    }
  }

  throw anonymousError instanceof Error ? anonymousError : new Error('获取公告失败');
}

async function syncAnnouncementsForSite(db: D1Database, siteId: number): Promise<PublicCheckinAnnouncement[]> {
  return withAccountMutex(
    `public-checkin-announcements:${siteId}`,
    async () => listAnnouncementsForSite(db, siteId),
    async () => {
      const { site, items } = await fetchAnnouncementsForSite(db, siteId);
      const now = unixNow();
      const existingRows = await dbAll<PublicCheckinAnnouncementRow>(db, `
        SELECT
          id,
          site_id,
          source_key,
          title,
          content,
          level,
          source_url,
          first_seen_at,
          last_seen_at,
          read_at
        FROM public_checkin_announcements
        WHERE site_id = ?
      `, [siteId]);
      const existingMap = new Map(existingRows.map((row) => [row.source_key, row]));

      for (const item of items) {
        const title = item.title.trim() || '站点公告';
        const content = item.content.trim();
        if (!content) {
          continue;
        }

        const existing = existingMap.get(item.sourceKey);
        if (existing) {
          await dbRun(db, `
            UPDATE public_checkin_announcements
            SET title = ?, content = ?, level = ?, source_url = ?, last_seen_at = ?
            WHERE id = ?
          `, [title, content, item.level, item.sourceUrl, now, Number(existing.id)]);
          continue;
        }

        await dbRun(db, `
          INSERT INTO public_checkin_announcements (
            site_id,
            source_key,
            title,
            content,
            level,
            source_url,
            first_seen_at,
            last_seen_at,
            read_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `, [siteId, item.sourceKey, title, content, item.level, item.sourceUrl, now, now]);

        await sendAnnouncementNotification(db, {
          siteName: site.name,
          title,
          content,
          sourceUrl: item.sourceUrl,
          discoveredAt: now
        }).catch((error) => {
          console.warn(`[PublicCheckin] 公告通知发送失败: ${site.name}`, error);
        });
      }

      return listAnnouncementsForSite(db, siteId);
    }
  );
}

async function syncAnnouncementsForAllSites(db: D1Database): Promise<void> {
  const rows = await dbAll<{ site_id: number }>(db, `
    SELECT DISTINCT site_id
    FROM public_checkin_accounts
    ORDER BY site_id ASC
  `);

  for (const row of rows) {
    const siteId = Number(row.site_id);
    try {
      await syncAnnouncementsForSite(db, siteId);
    } catch (error) {
      console.warn(`[PublicCheckin] 公告同步失败: siteId=${siteId}`, error);
    }
  }
}

async function getSettings(db: D1Database): Promise<PublicCheckinSettings> {
  const rows = await dbAll<{ key: string; value: string }>(db, 'SELECT key, value FROM public_checkin_settings');
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const checkinTime = normalizeCheckinTime(values.get('checkinTime') || cronToDailyTime(values.get('checkinCron')) || DEFAULT_SETTINGS.checkinTime);
  const announcementPollingIntervalMinutes = values.has('announcementPollingIntervalMinutes')
    ? normalizeAnnouncementPollingInterval(values.get('announcementPollingIntervalMinutes'))
    : DEFAULT_SETTINGS.announcementPollingIntervalMinutes;
  return {
    checkinCron: dailyTimeToCron(checkinTime),
    checkinTime,
    timezone: values.get('timezone') || DEFAULT_SETTINGS.timezone,
    announcementPollingIntervalMinutes
  };
}

function validateSettings(settings: PublicCheckinSettings): void {
  if (!validateCronExpression(settings.checkinCron)) throw new HTTPException(400, { message: '签到 Cron 表达式不合法' });
  normalizeCheckinTime(settings.checkinTime);
  normalizeAnnouncementPollingInterval(settings.announcementPollingIntervalMinutes);
  if (!settings.timezone.trim()) throw new HTTPException(400, { message: '时区不能为空' });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone }).format(new Date());
  } catch {
    throw new HTTPException(400, { message: '时区名称不合法' });
  }
}

async function updateSettings(db: D1Database, body: unknown): Promise<PublicCheckinSettings> {
  const input = asRecord(body);
  const checkinTime = normalizeCheckinTime(input.checkinTime ?? cronToDailyTime(asString(input.checkinCron)));
  const next = {
    checkinCron: dailyTimeToCron(checkinTime),
    checkinTime,
    timezone: asString(input.timezone).trim(),
    announcementPollingIntervalMinutes: normalizeAnnouncementPollingInterval(
      input.announcementPollingIntervalMinutes ?? DEFAULT_SETTINGS.announcementPollingIntervalMinutes
    )
  };
  validateSettings(next);
  const now = unixNow();
  for (const [key, value] of Object.entries(next)) {
    await dbRun(db, `
      INSERT INTO public_checkin_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `, [key, value, now]);
  }
  return next;
}

function normalizeCheckinTime(value: unknown): string {
  const text = asString(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) throw new HTTPException(400, { message: '签到时间格式不合法' });
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isSafeInteger(hour) || !Number.isSafeInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new HTTPException(400, { message: '签到时间格式不合法' });
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function dailyTimeToCron(value: string): string {
  const [hour, minute] = normalizeCheckinTime(value).split(':');
  return `${Number(minute)} ${Number(hour)} * * *`;
}

function cronToDailyTime(value: unknown): string | null {
  const text = asString(value).trim();
  const match = text.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!match) return null;
  try {
    return normalizeCheckinTime(`${match[2]}:${match[1]}`);
  } catch {
    return null;
  }
}

async function listCheckinLogs(db: D1Database, queryInput: URLSearchParams) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const accountId = asPositiveInt(queryInput.get('accountId'));
  if (accountId) {
    conditions.push('l.account_id = ?');
    values.push(accountId);
  }
  const status = normalizeCheckinStatus(queryInput.get('status'));
  if (status) {
    conditions.push('l.status = ?');
    values.push(status);
  }
  const startAt = asPositiveInt(queryInput.get('startAt'));
  if (startAt) {
    conditions.push('l.executed_at >= ?');
    values.push(startAt);
  }
  const endAt = asPositiveInt(queryInput.get('endAt'));
  if (endAt) {
    conditions.push('l.executed_at <= ?');
    values.push(endAt);
  }
  const limit = Math.min(Math.max(asPositiveInt(queryInput.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(queryInput.get('offset') || 0), 0);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const items = await dbAll(db, `
    SELECT
      l.id AS id,
      l.account_id AS accountId,
      l.triggered_by AS triggeredBy,
      l.status AS status,
      l.reward AS reward,
      l.reward_note AS rewardNote,
      l.error_message AS errorMessage,
      l.executed_at AS executedAt,
      a.label AS accountLabel,
      s.name AS siteName
    FROM public_checkin_logs l
    INNER JOIN public_checkin_accounts a ON a.id = l.account_id
    INNER JOIN public_checkin_sites s ON s.id = a.site_id
    ${where}
    ORDER BY l.executed_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `, [...values, limit, offset]);
  const count = await dbFirst<{ count: number }>(db, `
    SELECT COUNT(*) AS count
    FROM public_checkin_logs l
    ${where}
  `, values);
  return { items, total: Number(count?.count || 0), limit, offset };
}

async function getCheckinStats(db: D1Database) {
  const now = unixNow();
  const todayStart = now - (now % 86400);
  const sevenDaysAgo = now - 7 * 86400;
  const [totalAccounts, enabledAccounts, todaySuccess, todayReward, sevenDay] = await Promise.all([
    dbFirst<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM public_checkin_accounts'),
    dbFirst<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM public_checkin_accounts WHERE checkin_enabled = 1'),
    dbFirst<{ count: number }>(db, "SELECT COUNT(*) AS count FROM public_checkin_logs WHERE status = 'success' AND executed_at >= ?", [todayStart]),
    dbFirst<{ total: number }>(db, "SELECT COALESCE(SUM(reward), 0) AS total FROM public_checkin_logs WHERE status = 'success' AND executed_at >= ?", [todayStart]),
    dbAll(db, `
      SELECT status, COUNT(*) AS count, COALESCE(SUM(reward), 0) AS reward
      FROM public_checkin_logs
      WHERE executed_at >= ?
      GROUP BY status
    `, [sevenDaysAgo])
  ]);

  return {
    totalAccounts: Number(totalAccounts?.count || 0),
    enabledAccounts: Number(enabledAccounts?.count || 0),
    todaySuccess: Number(todaySuccess?.count || 0),
    todayReward: Number(todayReward?.total || 0),
    sevenDay
  };
}

async function listSites(db: D1Database): Promise<PublicCheckinSite[]> {
  const rows = await dbAll<SiteRow>(db, 'SELECT * FROM public_checkin_sites ORDER BY updated_at DESC, id DESC');
  return rows.map(siteFromRow);
}

async function createSite(db: D1Database, body: unknown): Promise<PublicCheckinSite> {
  const input = validateSiteInput(body);
  await assertUniqueSiteUrl(db, input.url);
  const now = unixNow();
  const result = await dbRun(db, `
    INSERT INTO public_checkin_sites (name, url, platform, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `, [input.name, input.url, input.platform, now, now]);
  const row = await dbFirst<SiteRow>(db, 'SELECT * FROM public_checkin_sites WHERE id = ?', [Number(result.meta.last_row_id)]);
  if (!row) throw new HTTPException(500, { message: '站点创建失败' });
  return siteFromRow(row);
}

async function updateSite(db: D1Database, id: number, body: unknown): Promise<PublicCheckinSite> {
  const input = validateSiteInput(body);
  await assertUniqueSiteUrl(db, input.url, id);
  await dbRun(db, `
    UPDATE public_checkin_sites
    SET name = ?, url = ?, platform = ?, updated_at = ?
    WHERE id = ?
  `, [input.name, input.url, input.platform, unixNow(), id]);
  const row = await dbFirst<SiteRow>(db, 'SELECT * FROM public_checkin_sites WHERE id = ?', [id]);
  if (!row) throw new HTTPException(404, { message: '站点不存在' });
  return siteFromRow(row);
}

async function deleteSite(db: D1Database, id: number): Promise<void> {
  const count = await dbFirst<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM public_checkin_accounts WHERE site_id = ?', [id]);
  if (Number(count?.count || 0) > 0) {
    throw new HTTPException(400, { message: '该站点仍有关联账号，不能删除' });
  }
  await dbRun(db, 'DELETE FROM public_checkin_sites WHERE id = ?', [id]);
}

async function deleteOldLogs(db: D1Database, days = 30): Promise<number> {
  const result = await dbRun(db, 'DELETE FROM public_checkin_logs WHERE executed_at < ?', [unixNow() - days * 86400]);
  return Number(result.meta.changes || 0);
}

function routeId(value: unknown): number {
  const id = asPositiveInt(value);
  if (!id) throw new HTTPException(400, { message: 'ID 不合法' });
  return id;
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => ({}));
}

export function registerPublicCheckinRoutes(app: Hono<any>): void {
  app.get('/api/public-checkin/accounts', async (c) => c.json(await listAccounts(c.env.DB)));
  app.post('/api/public-checkin/accounts', async (c) => c.json(await createAccount(c.env.DB, await readBody(c)), 201));
  app.post('/api/public-checkin/accounts/test-connection', async (c) => c.json(await testAccountConnection(c.env.DB, await readBody(c))));
  app.get('/api/public-checkin/accounts/:id/credential', async (c) => {
    const row = await getAccountWithSite(c.env.DB, routeId(c.req.param('id')));
    if (!row) throw new HTTPException(404, { message: '账号不存在' });
    return c.json({
      credentialType: row.account.credential_type,
      credential: decryptAccountCredential(row.account),
      apiKey: decryptAccountApiKey(row.account)
    });
  });
  app.put('/api/public-checkin/accounts/:id', async (c) => c.json(await updateAccount(c.env.DB, routeId(c.req.param('id')), await readBody(c))));
  app.delete('/api/public-checkin/accounts/:id', async (c) => {
    await dbRun(c.env.DB, 'DELETE FROM public_checkin_accounts WHERE id = ?', [routeId(c.req.param('id'))]);
    return c.body(null, 204);
  });
  app.post('/api/public-checkin/accounts/:id/test', async (c) => c.json(await refreshBalanceForAccount(c.env.DB, routeId(c.req.param('id')))));
  app.post('/api/public-checkin/accounts/:id/models/test', async (c) => c.json(await testAccountModels(c.env.DB, routeId(c.req.param('id')))));
  app.post('/api/public-checkin/accounts/:id/models/probe', async (c) => c.json(await probeAccountModel(c.env.DB, routeId(c.req.param('id')), await readBody(c))));
  app.get('/api/public-checkin/accounts/:id/announcements', async (c) => {
    return c.json(await listAnnouncementsForAccount(c.env.DB, routeId(c.req.param('id'))));
  });
  app.post('/api/public-checkin/accounts/:id/announcements/sync', async (c) => {
    const account = await getAccountWithSiteForAnnouncement(c.env.DB, routeId(c.req.param('id')));
    if (!account) throw new HTTPException(404, { message: '账号不存在' });
    return c.json(await syncAnnouncementsForSite(c.env.DB, Number(account.site.id)));
  });
  app.post('/api/public-checkin/accounts/:id/announcements/read-all', async (c) => {
    const account = await getAccountWithSiteForAnnouncement(c.env.DB, routeId(c.req.param('id')));
    if (!account) throw new HTTPException(404, { message: '账号不存在' });
    await markAnnouncementsReadForSite(c.env.DB, Number(account.site.id));
    return c.json({ ok: true });
  });

  app.get('/api/public-checkin/sites', async (c) => c.json(await listSites(c.env.DB)));
  app.post('/api/public-checkin/sites', async (c) => c.json(await createSite(c.env.DB, await readBody(c)), 201));
  app.put('/api/public-checkin/sites/:id', async (c) => c.json(await updateSite(c.env.DB, routeId(c.req.param('id')), await readBody(c))));
  app.delete('/api/public-checkin/sites/:id', async (c) => {
    await deleteSite(c.env.DB, routeId(c.req.param('id')));
    return c.body(null, 204);
  });

  app.post('/api/public-checkin/checkin/run-all', async (c) => c.json(await runCheckinAll(c.env.DB, 'manual')));
  app.post('/api/public-checkin/checkin/run/:id', async (c) => c.json(await runCheckinForAccount(c.env.DB, routeId(c.req.param('id')), 'manual')));
  app.get('/api/public-checkin/checkin/logs', async (c) => c.json(await listCheckinLogs(c.env.DB, new URL(c.req.url).searchParams)));
  app.get('/api/public-checkin/checkin/stats', async (c) => c.json(await getCheckinStats(c.env.DB)));

  app.post('/api/public-checkin/balance/refresh-all', async (c) => c.json(await refreshBalanceAll(c.env.DB)));
  app.post('/api/public-checkin/balance/refresh/:id', async (c) => c.json(await refreshBalanceForAccount(c.env.DB, routeId(c.req.param('id')))));

  app.get('/api/system/yescaptcha-config', async (c) => c.json({ item: await getYesCaptchaConfig(c.env.DB) }));
  app.put('/api/system/yescaptcha-config', async (c) => c.json({ item: await updateYesCaptchaConfig(c.env.DB, await readBody(c)) }));

  app.get('/api/public-checkin/settings', async (c) => c.json(await getSettings(c.env.DB)));
  app.put('/api/public-checkin/settings', async (c) => {
    const settings = await updateSettings(c.env.DB, await readBody(c));
    await restartPublicCheckinScheduler(c.env.DB);
    return c.json(settings);
  });
  app.post('/api/public-checkin/settings/cleanup-logs', async (c) => c.json({ deleted: await deleteOldLogs(c.env.DB, 30) }));
}

type CronField = Set<number>;
type ParsedCron = [CronField, CronField, CronField, CronField, CronField];

class SimpleCronTask {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRunKey = '';
  private readonly parsed: ParsedCron;
  private readonly expression: string;
  private readonly timezone: string;
  private readonly task: () => Promise<void>;

  constructor(expression: string, timezone: string, task: () => Promise<void>) {
    this.expression = expression;
    this.timezone = timezone;
    this.task = task;
    this.parsed = parseCronExpression(expression);
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.tick();
    }, 30_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const local = getZonedDateParts(now, this.timezone);
    const key = `${local.year}-${local.month}-${local.day}-${local.hour}-${local.minute}`;
    if (key === this.lastRunKey || !matchesCron(this.parsed, local)) return;
    this.lastRunKey = key;
    await this.task();
  }
}

export async function startPublicCheckinScheduler(db: D1Database): Promise<() => void> {
  schedulerDb = db;
  schedulerStarted = true;
  await restartPublicCheckinScheduler(db);
  return () => {
    stopPublicCheckinScheduler();
  };
}

async function restartPublicCheckinScheduler(db: D1Database): Promise<void> {
  if (!schedulerStarted) return;
  stopPublicCheckinSchedulesOnly();
  schedulerDb = db;
  const settings = await getSettings(db);
  checkinSchedule = new SimpleCronTask(settings.checkinCron, settings.timezone, async () => {
    console.info('[PublicCheckin] 开始执行定时签到');
    try {
      const results = await runCheckinAll(db, 'scheduler');
      await sendSchedulerSummaryNotification(db, results).catch((error) => {
        console.warn('[PublicCheckin] Telegram 签到汇总通知发送失败', error);
      });
    } catch (error) {
      console.error('[PublicCheckin] 定时签到执行异常', error);
      await sendSchedulerErrorNotification(db, error).catch((notificationError) => {
        console.warn('[PublicCheckin] Telegram 签到异常通知发送失败', notificationError);
      });
    }
  });
  balanceSchedule = new SimpleCronTask('0 0 * * *', settings.timezone, async () => {
    console.info('[PublicCheckin] 开始采集每日余额基线');
    try {
      await captureDailyBalanceBaselines(db, settings.timezone);
    } catch (error) {
      console.error('[PublicCheckin] 每日余额基线采集异常', error);
    }
  });
  checkinSchedule.start();
  balanceSchedule.start();
  scheduleAnnouncementPolling(db, settings.announcementPollingIntervalMinutes, !announcementPollingBootstrapped);
  announcementPollingBootstrapped = true;
  console.info(
    `[PublicCheckin] 调度器已启动: checkin=${settings.checkinCron}, balance=0 0 * * *, timezone=${settings.timezone}, announcements=${settings.announcementPollingIntervalMinutes}m`
  );
}

function stopPublicCheckinSchedulesOnly(): void {
  checkinSchedule?.stop();
  balanceSchedule?.stop();
  if (announcementPollTimer) {
    clearTimeout(announcementPollTimer);
  }
  checkinSchedule = null;
  balanceSchedule = null;
  announcementPollTimer = null;
}

function stopPublicCheckinScheduler(): void {
  stopPublicCheckinSchedulesOnly();
  schedulerDb = null;
  schedulerStarted = false;
  announcementPollingInFlight = false;
  announcementPollingBootstrapped = false;
}

function scheduleAnnouncementPolling(
  db: D1Database,
  intervalMinutes: 15 | 30 | 60,
  immediate = false
): void {
  if (announcementPollTimer) {
    clearTimeout(announcementPollTimer);
  }

  const delayMs = immediate ? 0 : intervalMinutes * 60_000;
  announcementPollTimer = setTimeout(async () => {
    await runAnnouncementPollingCycle(db, intervalMinutes);
  }, delayMs);
}

async function runAnnouncementPollingCycle(db: D1Database, intervalMinutes: 15 | 30 | 60): Promise<void> {
  if (!schedulerStarted) {
    return;
  }

  if (announcementPollingInFlight) {
    console.info('[PublicCheckin] 公告轮询仍在执行中，跳过本轮');
    scheduleAnnouncementPolling(db, intervalMinutes, false);
    return;
  }

  announcementPollingInFlight = true;
  try {
    console.info('[PublicCheckin] 开始执行公告轮询');
    await syncAnnouncementsForAllSites(db);
  } catch (error) {
    console.error('[PublicCheckin] 公告轮询执行异常', error);
  } finally {
    announcementPollingInFlight = false;
    scheduleAnnouncementPolling(db, intervalMinutes, false);
  }
}

function validateCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}

function parseCronExpression(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron requires five fields');
  return [
    parseCronField(parts[0], 0, 59),
    parseCronField(parts[1], 0, 23),
    parseCronField(parts[2], 1, 31),
    parseCronField(parts[3], 1, 12),
    parseCronField(parts[4], 0, 7, true)
  ];
}

function parseCronField(field: string, min: number, max: number, sundayAlias = false): CronField {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isSafeInteger(step) || step <= 0) throw new Error('invalid cron step');
    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [left, right] = rangePart.split('-').map(Number);
      start = left;
      end = right;
    } else {
      start = Number(rangePart);
      end = start;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < min || end > max || start > end) {
      throw new Error('invalid cron field');
    }
    for (let value = start; value <= end; value += step) {
      values.add(sundayAlias && value === 7 ? 0 : value);
    }
  }
  if (values.size === 0) throw new Error('empty cron field');
  return values;
}

function getZonedDateParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hour = read('hour');
  const minute = read('minute');
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, dayOfWeek };
}

function matchesCron(parsed: ParsedCron, parts: ReturnType<typeof getZonedDateParts>): boolean {
  return parsed[0].has(parts.minute)
    && parsed[1].has(parts.hour)
    && parsed[2].has(parts.day)
    && parsed[3].has(parts.month)
    && parsed[4].has(parts.dayOfWeek);
}

export const publicCheckinTestHooks = {
  normalizeCookieHeader,
  extractPlatformUserIdFromHeaders,
  normalizeCredentialInput,
  inferPublicCheckinPlatform,
  toStoredPublicCheckinPlatform,
  getProxyUrl,
  mergeSetCookieValues,
  isTurnstileTokenMissingMessage,
  appendTurnstileToRequestPath,
  withTurnstileRequestBody,
  extractYesCaptchaTurnstileToken,
  getYesCaptchaConfig,
  updateYesCaptchaConfig,
  getConfiguredYesCaptchaClientKey,
  createAdapter,
  encryptCredential,
  decryptCredentialText,
  decryptAccountApiKey,
  extractModelIds,
  sortPublicCheckinModelIds,
  buildPublicCheckinModelProbeResponse,
  extractOpenAiResponseText,
  normalizeOpenAiCompatibleErrorMessage,
  probeOpenAiCompatibleModel,
  solveAcwScV2,
  parseJsonResponsePayload,
  parseBalancePayload,
  inferPublicCheckinRewardFromBalanceDelta,
  buildCheckinResultForNotification,
  validateCronExpression,
  formatZonedLocalDate,
  resolveDailyBalanceDisplayState,
  listAccounts,
  refreshBalanceForAccount,
  captureDailyBalanceBaselines,
  extractAnnouncementsFromNoticePayload,
  buildAnnouncementSourceKey,
  normalizeAnnouncementLevel,
  syncAnnouncementsForSite,
  listAnnouncementsForAccount,
  markAnnouncementsReadForSite,
  setAdapterOverride(factory: typeof adapterOverride) {
    adapterOverride = factory;
  },
  setAnnouncementNotificationSenderOverride(factory: typeof announcementNotificationSenderOverride) {
    announcementNotificationSenderOverride = factory;
  },
  setOpenAiCompatibleFetchOverride(factory: typeof openAiCompatibleFetchOverride) {
    openAiCompatibleFetchOverride = factory;
  }
};
