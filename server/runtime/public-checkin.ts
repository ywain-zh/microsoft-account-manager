import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

export type PublicCheckinPlatform = 'new-api' | 'one-api' | 'onehub';
export type PublicCheckinCredentialType = 'password' | 'access_token' | 'cookie';
export type PublicCheckinAccountStatus = 'active' | 'disabled' | 'error';
export type PublicCheckinStatus = 'success' | 'failed' | 'skipped';
export type PublicCheckinTriggeredBy = 'scheduler' | 'manual';

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
  balance: number | null;
  balanceUpdatedAt: number | null;
  checkinEnabled: boolean;
  useProxy: boolean;
  status: PublicCheckinAccountStatus;
  lastError: string | null;
  lastCheckinReward: number | null;
  healthState: 'normal' | 'abnormal' | 'failed' | 'unknown';
  healthMessage: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  site: PublicCheckinSite;
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
}

interface BalanceResult {
  success: boolean;
  balance?: number;
  errorMessage?: string;
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
}

const DEFAULT_SETTINGS: PublicCheckinSettings = {
  checkinCron: process.env.CHECKIN_CRON || '0 8 * * *',
  checkinTime: '08:00',
  timezone: process.env.TZ || 'Asia/Shanghai'
};
const SYSTEM_PROXY_CONFIG_KEY = 'system_proxy_config';

const runningTasks = new Set<string>();
let checkinSchedule: SimpleCronTask | null = null;
let balanceSchedule: SimpleCronTask | null = null;
let schedulerDb: D1Database | null = null;
let schedulerStarted = false;

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

function normalizePlatform(value: unknown): PublicCheckinPlatform {
  const platform = asString(value).trim();
  if (platform === 'new-api' || platform === 'one-api' || platform === 'onehub') return platform;
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
  return {
    name,
    url: normalizeUrl(asString(input.url)),
    platform: normalizePlatform(input.platform)
  };
}

function validateAccountInput(value: unknown, requireCredential: boolean): {
  siteId?: number;
  site?: Pick<PublicCheckinSite, 'name' | 'url' | 'platform'>;
  label: string;
  credentialType: PublicCheckinCredentialType;
  credential: PublicCheckinCredential | null;
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

  return {
    siteId,
    site,
    label: asString(input.label).trim(),
    credentialType,
    credential,
    checkinEnabled: asBoolean(input.checkinEnabled, true),
    useProxy: asBoolean(input.useProxy, false),
    status: input.status === undefined ? undefined : normalizeAccountStatus(input.status)
  };
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

async function createAdapterForAccount(
  db: D1Database,
  platform: PublicCheckinPlatform,
  siteUrl: string,
  useProxy: boolean
): Promise<PublicCheckinAdapter> {
  return createAdapter(platform, siteUrl, {
    useProxy,
    proxyUrl: useProxy ? await getSystemProxyUrl(db) : ''
  });
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

function toSafeAccount(account: AccountRow, site: SiteRow, lastCheckinReward: number | null = null): PublicCheckinAccount {
  const health = resolveHealth(account);
  return {
    id: Number(account.id),
    siteId: Number(account.site_id),
    label: account.label,
    credentialType: account.credential_type,
    hasCredential: Boolean(account.credential_data),
    balance: account.balance == null ? null : Number(account.balance),
    balanceUpdatedAt: account.balance_updated_at == null ? null : Number(account.balance_updated_at),
    checkinEnabled: Number(account.checkin_enabled) === 1,
    useProxy: Number(account.use_proxy) === 1,
    status: account.status,
    lastError: account.last_error,
    lastCheckinReward,
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

function parseBalancePayload(payload: unknown): number | undefined {
  const source = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data?: unknown }).data
    : payload;
  if (!source || typeof source !== 'object') return undefined;

  const record = source as Record<string, unknown>;
  const balance = Number(record.balance);
  if (Number.isFinite(balance)) return balance;

  const quota = Number(record.quota);
  if (Number.isFinite(quota)) return quota / 500000;

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
  text: string;
};

type AdapterOptions = {
  useProxy?: boolean;
  proxyUrl?: string;
};

class PublicCheckinAdapter {
  protected readonly siteUrl: string;
  protected readonly useProxy: boolean;
  protected readonly proxyUrl: string;

  constructor(siteUrl: string, options: AdapterOptions = {}) {
    this.siteUrl = normalizeUrl(siteUrl);
    this.useProxy = options.useProxy === true;
    this.proxyUrl = options.proxyUrl?.trim() || '';
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
      try {
        const payload = await this.fetchJson<Record<string, unknown>>(attempt.path, {
          method: 'POST',
          body: attempt.body,
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
        errors.push(message || `${attempt.path} 签到失败`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${attempt.path} 签到请求失败`);
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

  protected async fetchJson<T>(requestPath: string, init: RequestInit = {}): Promise<T> {
    let response = await this.requestText(requestPath, init);
    const contentType = response.headers.get('content-type') || '';
    if (response.text.trim().startsWith('<') || contentType.includes('text/html')) {
      const nextAcwScV2 = solveAcwScV2(response.text);
      const headers = init.headers as Record<string, string> | undefined;
      const cookie = headers?.Cookie || headers?.cookie;
      if (nextAcwScV2 && cookie) {
        response = await this.requestText(requestPath, {
          ...init,
          headers: {
            ...(headers || {}),
            Cookie: upsertCookieValue(cookie, 'acw_sc__v2', nextAcwScV2)
          }
        });
        const retryContentType = response.headers.get('content-type') || '';
        if (!response.text.trim().startsWith('<') && !retryContentType.includes('text/html')) {
          return this.parseJsonResponse<T>(response);
        }
      }
      const title = response.text.match(/<title>\s*([^<]+)\s*<\/title>/i)?.[1]?.trim();
      const isChallenge = /arg1|acw_sc__v2|cdn_sec_tc|challenge|验证|安全/i.test(response.text);
      throw new Error(isChallenge
        ? `站点返回了防护挑战页面${title ? `：${title}` : ''}，请确认已启用本地代理并填写完整浏览器 Cookie / 平台用户 ID`
        : `站点返回了 HTML 页面${title ? `：${title}` : ''}，不是 JSON API 响应`);
    }

    return this.parseJsonResponse<T>(response);
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
    if (this.useProxy) {
      return requestViaProxy(url, {
        method: init.method || 'GET',
        headers,
        body,
        proxyUrl: this.proxyUrl
      });
    }

    const fetchResponse = await fetch(url, {
      method: init.method || 'GET',
      headers,
      body
    });
    return {
      ok: fetchResponse.ok,
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
      headers: new Map(Array.from(fetchResponse.headers.entries()).map(([key, value]) => [key.toLowerCase(), value])),
      text: await fetchResponse.text()
    };
  }

  private parseJsonResponse<T>(response: RawResponse): T {
    let payload: unknown = null;
    try {
      payload = response.text ? JSON.parse(response.text) : null;
    } catch {
      throw new Error(`站点返回的内容不是 JSON：${response.text.slice(0, 120)}`);
    }
    if (!response.ok) {
      const record = asRecord(payload);
      const error = asRecord(record.error);
      const message = asString(record.message || error.message || response.text);
      throw new Error(`HTTP ${response.status}: ${message || response.statusText}`);
    }
    return payload as T;
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

  private buildPlatformUserHeaders(platformUserId?: number): Record<string, string> {
    if (!platformUserId || !Number.isFinite(platformUserId)) return {};
    const value = String(Math.trunc(platformUserId));
    return {
      'New-Api-User': value,
      'New-API-User': value,
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

function createAdapter(platform: PublicCheckinPlatform, siteUrl: string, options: AdapterOptions): PublicCheckinAdapter {
  if (platform === 'onehub') return new OneHubAdapter(siteUrl, options);
  return new PublicCheckinAdapter(siteUrl, options);
}

function getProxyUrl(configuredProxyUrl = ''): string {
  const proxyUrl = configuredProxyUrl || process.env.SERVER_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  const trimmed = proxyUrl.trim();
  if (!trimmed) {
    throw new Error('已启用本地代理，但系统设置里未配置代理地址');
  }
  return trimmed;
}

async function requestViaProxy(target: URL, input: { method: string; headers: Record<string, string>; body?: string; proxyUrl?: string }): Promise<RawResponse> {
  const proxy = new URL(getProxyUrl(input.proxyUrl));
  if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') {
    throw new Error('当前仅支持 HTTP/HTTPS 本地代理');
  }

  const method = input.method.toUpperCase();
  const body = input.body || '';
  const headers = { ...input.headers };
  if (body) headers['Content-Length'] = String(Buffer.byteLength(body));
  headers.Connection = 'close';

  let socket: net.Socket | tls.TLSSocket;
  let requestTarget = `${target.pathname}${target.search}`;
  if (target.protocol === 'https:') {
    const rawSocket = await createProxyTunnel(proxy, target);
    socket = await tlsConnect(rawSocket, target.hostname);
  } else {
    socket = await connectProxySocket(proxy);
    requestTarget = target.toString();
  }

  const requestLines = [
    `${method} ${requestTarget} HTTP/1.1`,
    `Host: ${target.host}`,
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
    '',
    body
  ];
  socket.write(requestLines.join('\r\n'));
  return readRawHttpResponse(socket);
}

function proxyPort(proxy: URL): number {
  if (proxy.port) return Number(proxy.port);
  return proxy.protocol === 'https:' ? 443 : 80;
}

function proxyAuthHeader(proxy: URL): string | null {
  if (!proxy.username && !proxy.password) return null;
  return `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
}

function connectProxySocket(proxy: URL): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    const socket = proxy.protocol === 'https:'
      ? tls.connect({ host: proxy.hostname, port: proxyPort(proxy), servername: proxy.hostname }, () => {
        socket.off('error', onError);
        resolve(socket);
      })
      : net.connect({ host: proxy.hostname, port: proxyPort(proxy) }, () => {
        socket.off('error', onError);
        resolve(socket);
      });
    socket.once('error', onError);
  });
}

async function createProxyTunnel(proxy: URL, target: URL): Promise<net.Socket | tls.TLSSocket> {
  const socket = await connectProxySocket(proxy);
  const auth = proxyAuthHeader(proxy);
  const targetPort = target.port || '443';
  const lines = [
    `CONNECT ${target.hostname}:${targetPort} HTTP/1.1`,
    `Host: ${target.hostname}:${targetPort}`,
    'Connection: close',
    ...(auth ? [`Proxy-Authorization: ${auth}`] : []),
    '',
    ''
  ];
  socket.write(lines.join('\r\n'));
  const response = await readUntilHeaderEnd(socket);
  const statusLine = response.toString('latin1').split('\r\n')[0] || '';
  if (!/^HTTP\/\d\.\d\s+2\d\d\b/.test(statusLine)) {
    socket.destroy();
    throw new Error(`代理 CONNECT 失败：${statusLine || '无响应'}`);
  }
  return socket;
}

function tlsConnect(socket: net.Socket | tls.TLSSocket, servername: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({ socket, servername }, () => resolve(tlsSocket));
    tlsSocket.once('error', reject);
  });
}

function readUntilHeaderEnd(socket: net.Socket | tls.TLSSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const index = buffer.indexOf('\r\n\r\n');
      if (index >= 0) {
        socket.off('data', onData);
        socket.off('error', onError);
        resolve(buffer.slice(0, index + 4));
      }
    };
    const onError = (error: Error) => {
      socket.off('data', onData);
      reject(error);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function readRawHttpResponse(socket: net.Socket | tls.TLSSocket): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        resolve(parseRawHttpResponse(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function parseRawHttpResponse(buffer: Buffer): RawResponse {
  const separator = buffer.indexOf('\r\n\r\n');
  if (separator < 0) throw new Error('代理响应格式无效');
  const headerText = buffer.slice(0, separator).toString('latin1');
  const bodyRaw = buffer.slice(separator + 4);
  const [statusLine, ...headerLines] = headerText.split('\r\n');
  const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)\s*(.*)$/);
  if (!statusMatch) throw new Error(`代理响应状态行无效：${statusLine}`);
  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  const status = Number(statusMatch[1]);
  const body = (headers.get('transfer-encoding') || '').toLowerCase().includes('chunked')
    ? decodeChunkedBody(bodyRaw)
    : bodyRaw;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusMatch[2] || http.STATUS_CODES[status] || '',
    headers,
    text: body.toString('utf8')
  };
}

function decodeChunkedBody(buffer: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd < 0) break;
    const sizeText = buffer.slice(offset, lineEnd).toString('latin1').split(';')[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(buffer.slice(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
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
    ORDER BY a.updated_at DESC, a.id DESC
  `);

  const rewardRows = await dbAll<{ account_id: number; reward: number | null }>(db, `
    SELECT account_id, reward
    FROM public_checkin_logs
    WHERE status = 'success'
    ORDER BY executed_at DESC, id DESC
  `);
  const rewards = new Map<number, number | null>();
  for (const row of rewardRows) {
    if (!rewards.has(Number(row.account_id))) {
      rewards.set(Number(row.account_id), row.reward == null ? null : Number(row.reward));
    }
  }

  return rows.map((row) => {
    const { account, site } = joinedToAccountWithSite(row);
    return toSafeAccount(account, site, rewards.get(account.id) ?? null);
  });
}

async function createAccount(db: D1Database, body: unknown): Promise<PublicCheckinAccount> {
  const input = validateAccountInput(body, true);
  const siteId = await ensureSite(db, input);
  const label = await resolveAccountLabel(db, input, siteId);
  const now = unixNow();
  const result = await dbRun(db, `
    INSERT INTO public_checkin_accounts (
      site_id, label, credential_type, credential_data, checkin_enabled, use_proxy, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    siteId,
    label,
    input.credentialType,
    encryptCredential(JSON.stringify(input.credential)),
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
      SET site_id = ?, label = ?, credential_type = ?, credential_data = ?, checkin_enabled = ?, use_proxy = ?, status = ?, updated_at = ?
      WHERE id = ?
    `, [
      siteId,
      label,
      input.credentialType,
      encryptCredential(JSON.stringify(input.credential)),
      input.checkinEnabled ? 1 : 0,
      input.useProxy ? 1 : 0,
      input.status || current.account.status,
      now,
      accountId
    ]);
  } else {
    await dbRun(db, `
      UPDATE public_checkin_accounts
      SET site_id = ?, label = ?, credential_type = ?, checkin_enabled = ?, use_proxy = ?, status = ?, updated_at = ?
      WHERE id = ?
    `, [
      siteId,
      label,
      input.credentialType,
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

async function resolveCredential(db: D1Database, accountId: number): Promise<AccountWithSite & { credential: PublicCheckinCredential }> {
  const row = await getAccountWithSite(db, accountId);
  if (!row) throw new HTTPException(404, { message: '账号不存在' });
  const credential = decryptAccountCredential(row.account);
  if (credential.type !== 'password') return { ...row, credential };

  const adapter = await createAdapterForAccount(db, row.site.platform, row.site.url, row.account.use_proxy === 1);
  const login = await adapter.login(credential.username || '', credential.password || '');
  if (!login.success || !login.accessToken) {
    throw new Error(login.errorMessage || '密码登录失败');
  }
  const nextCredential: PublicCheckinCredential = { type: 'access_token', accessToken: login.accessToken };
  await updateCredential(db, accountId, nextCredential, 'access_token');
  return { ...row, credential: nextCredential };
}

async function refreshBalanceForAccount(db: D1Database, accountId: number): Promise<BalanceResult> {
  let resolved: Awaited<ReturnType<typeof resolveCredential>>;
  try {
    resolved = await resolveCredential(db, accountId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '余额刷新失败';
    await setAccountError(db, accountId, errorMessage, 'error');
    return { success: false, errorMessage };
  }

  const adapter = await createAdapterForAccount(db, resolved.site.platform, resolved.site.url, resolved.account.use_proxy === 1);
  const result: BalanceResult = await adapter.getBalance(resolved.credential).catch((error) => ({
    success: false,
    errorMessage: error instanceof Error ? error.message : '余额刷新失败'
  }));
  const now = unixNow();
  if (result.success && typeof result.balance === 'number') {
    await dbRun(db, `
      UPDATE public_checkin_accounts
      SET balance = ?, balance_updated_at = ?, last_error = NULL, status = 'active', updated_at = ?
      WHERE id = ?
    `, [result.balance, now, now, accountId]);
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
  const adapter = await createAdapterForAccount(db, row.site.platform, row.site.url, row.account.use_proxy === 1);
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
  await insertCheckinLog(db, {
    accountId,
    triggeredBy,
    status,
    reward: result.reward ?? null,
    rewardNote: result.rewardNote ?? null,
    errorMessage: result.errorMessage ?? null
  });

  if (result.success) {
    await setAccountError(db, accountId, null, 'active');
    try {
      await refreshBalanceForAccount(db, accountId);
    } catch {}
  } else {
    await setAccountError(db, accountId, result.errorMessage || '签到失败', 'error');
  }

  return { ...result, status };
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
    ORDER BY s.id ASC, a.id ASC
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
  const adapter = await createAdapterForAccount(db, site.platform, site.url, input.useProxy);
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

async function getSettings(db: D1Database): Promise<PublicCheckinSettings> {
  const rows = await dbAll<{ key: string; value: string }>(db, 'SELECT key, value FROM public_checkin_settings');
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const checkinTime = normalizeCheckinTime(values.get('checkinTime') || cronToDailyTime(values.get('checkinCron')) || DEFAULT_SETTINGS.checkinTime);
  return {
    checkinCron: dailyTimeToCron(checkinTime),
    checkinTime,
    timezone: values.get('timezone') || DEFAULT_SETTINGS.timezone
  };
}

function validateSettings(settings: PublicCheckinSettings): void {
  if (!validateCronExpression(settings.checkinCron)) throw new HTTPException(400, { message: '签到 Cron 表达式不合法' });
  normalizeCheckinTime(settings.checkinTime);
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
    timezone: asString(input.timezone).trim()
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
      credential: decryptAccountCredential(row.account)
    });
  });
  app.put('/api/public-checkin/accounts/:id', async (c) => c.json(await updateAccount(c.env.DB, routeId(c.req.param('id')), await readBody(c))));
  app.delete('/api/public-checkin/accounts/:id', async (c) => {
    await dbRun(c.env.DB, 'DELETE FROM public_checkin_accounts WHERE id = ?', [routeId(c.req.param('id'))]);
    return c.body(null, 204);
  });
  app.post('/api/public-checkin/accounts/:id/test', async (c) => c.json(await refreshBalanceForAccount(c.env.DB, routeId(c.req.param('id')))));

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
    await runCheckinAll(db, 'scheduler');
  });
  balanceSchedule = null;
  checkinSchedule.start();
  console.info(`[PublicCheckin] 调度器已启动: checkin=${settings.checkinCron}, timezone=${settings.timezone}`);
}

function stopPublicCheckinSchedulesOnly(): void {
  checkinSchedule?.stop();
  balanceSchedule?.stop();
  checkinSchedule = null;
  balanceSchedule = null;
}

function stopPublicCheckinScheduler(): void {
  stopPublicCheckinSchedulesOnly();
  schedulerDb = null;
  schedulerStarted = false;
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
  encryptCredential,
  decryptCredentialText,
  solveAcwScV2,
  validateCronExpression
};
