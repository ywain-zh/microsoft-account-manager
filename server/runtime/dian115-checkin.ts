import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as cryptoSign,
  type KeyObject
} from 'node:crypto';
import {
  fetch as undiciFetch,
  ProxyAgent,
  type Dispatcher,
  type RequestInit as UndiciRequestInit
} from 'undici';

import {
  decryptPublicCheckinSecret,
  encryptPublicCheckinSecret,
  formatZonedLocalDate,
  getPublicCheckinTimezone
} from './public-checkin.ts';

export type Dian115CheckinTriggeredBy = 'scheduler' | 'manual';
export type Dian115CheckinStatus = 'success' | 'repeat' | 'failed';
export type Dian115CheckinLogStatus = 'success' | 'failed' | 'skipped';
export type Dian115CheckinAccountStatus = 'active' | 'disabled' | 'error';
export type Dian115CheckinMode = 'normal' | 'lucky';
export type Dian115CredentialType = 'cookie' | 'password';

export interface Dian115CheckinAccount {
  id: number;
  label: string;
  credentialType: Dian115CredentialType;
  email: string | null;
  checkinMode: Dian115CheckinMode;
  checkinEnabled: boolean;
  useProxy: boolean;
  points: number | null;
  balanceUpdatedAt: number | null;
  /** 今日最近一次成功签到实际获得的积分，来自 dian115_checkin_logs，无记录为 null。 */
  todayRewardPoints: number | null;
  lastStatus: Dian115CheckinStatus | null;
  lastMessage: string | null;
  lastRunAt: number | null;
  status: Dian115CheckinAccountStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Dian115CheckinLog {
  id: number;
  accountId: number;
  triggeredBy: Dian115CheckinTriggeredBy;
  status: Dian115CheckinLogStatus;
  reward: number | null;
  rewardNote: string | null;
  errorMessage: string | null;
  executedAt: number;
  accountLabel: string;
  siteName: string;
}

export interface Dian115CheckinLogResponse {
  items: Dian115CheckinLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface Dian115TestResult {
  success: boolean;
  message: string;
  nickname?: string;
  email?: string;
  points?: number | null;
  lastSigninDate?: string | null;
}

/** 凭据接口：支持 Cookie 直填与邮箱密码自动登录两种方式。 */
export interface Dian115CredentialInput {
  cookie?: string;
  email?: string;
  password?: string;
  useProxy?: boolean;
}

/** 与 GladosCheckinRunResult 同构，签到汇总通知可直接合并 dian115 的结果。 */
export interface Dian115CheckinRunResult {
  accountId: number;
  label: string;
  siteName: string;
  result: {
    success: boolean;
    status?: 'success' | 'failed' | 'skipped';
    reward?: number | null;
    rewardNote?: string | null;
    errorMessage?: string | null;
    balanceBefore?: number | null;
    balanceAfter?: number | null;
  };
}

interface AccountRow {
  id: number;
  label: string;
  cookie_data: string;
  credential_type: Dian115CredentialType;
  email: string | null;
  password_data: string | null;
  checkin_mode: Dian115CheckinMode;
  checkin_enabled: number;
  use_proxy: number;
  points: number | null;
  balance_updated_at: number | null;
  last_status: Dian115CheckinStatus | null;
  last_message: string | null;
  last_run_at: number | null;
  status: Dian115CheckinAccountStatus;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface LogRow {
  id: number;
  account_id: number;
  triggered_by: Dian115CheckinTriggeredBy;
  status: Dian115CheckinLogStatus;
  reward: number | null;
  reward_note: string | null;
  error_message: string | null;
  executed_at: number;
}

/** GET /api/portal/me 返回的 user 对象中我们关心的字段子集。 */
interface Dian115UserProfile {
  email: string;
  nickname: string;
  points: number | null;
  lastSigninDate: string | null;
}

const DIAN115_URL = 'https://m.dian115.com';
const DIAN115_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const DIAN115_TIMEOUT_MS = 30_000;
const SYSTEM_PROXY_CONFIG_KEY = 'system_proxy_config';

let requestFetch: typeof undiciFetch = undiciFetch;
let betweenAccountsDelayMs = 1_000;

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function dbAll<T>(db: D1Database, query: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.prepare(query).bind(...values).all<T>();
  return result.results || [];
}

async function dbFirst<T>(db: D1Database, query: string, values: unknown[] = []): Promise<T | null> {
  return db.prepare(query).bind(...values).first<T>();
}

async function dbRun(db: D1Database, query: string, values: unknown[] = []): Promise<D1Result> {
  return db.prepare(query).bind(...values).run();
}

async function getAppSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await dbFirst<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = ? LIMIT 1', [key]);
  return row?.value ?? null;
}

async function getSystemProxyUrl(db: D1Database): Promise<string> {
  const value = await getAppSetting(db, SYSTEM_PROXY_CONFIG_KEY);
  if (!value) return '';
  try {
    const parsed = asRecord(Object(JSON.parse(value)));
    return asString(parsed.proxyUrl).trim();
  } catch {
    return '';
  }
}

/** 与公益站/GLaDOS 账号一致：只有账号显式开启 useProxy 时才走系统代理，默认直连。 */
async function resolveProxyUrl(db: D1Database, useProxy: boolean): Promise<string> {
  if (!useProxy) return '';
  const configured = await getSystemProxyUrl(db);
  return configured.trim();
}

const dian115ProxyAgentCache = new Map<string, Dispatcher>();

function getProxyDispatcher(proxyUrl: string): Dispatcher | undefined {
  const resolved = proxyUrl.trim();
  if (!resolved) return undefined;
  let agent = dian115ProxyAgentCache.get(resolved);
  if (!agent) {
    agent = new ProxyAgent(resolved);
    dian115ProxyAgentCache.set(resolved, agent);
  }
  return agent;
}

function routeId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: '无效的账号 ID' });
  return id;
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function validateLabel(value: unknown): string {
  const label = asString(value).trim();
  if (!label || label.length > 80) {
    throw new HTTPException(400, { message: '账号名称不能为空且不能超过 80 个字符' });
  }
  return label;
}

/** 从用户粘贴的 Cookie 中解析提取 dian115 的登录令牌（__Host-portal_token）。
 * 用户可能粘贴：
 *   1) 完整浏览器 Cookie 串（如 `__Host-portal_token=xxx; __Host-portal_browser=yyy; ...`）
 *   2) 单段 `__Host-portal_token=xxx`（可能带尾部分号）
 *   3) 只粘贴裸 JWT 值（自动补前缀）
 * 只返回对签到真正有用的 `__Host-portal_token=<JWT>`，忽略浏览器会话等其他 Cookie，
 * 并对长 JWT 粘贴导致的折行/空格做清洗，避免平台判定 invalid_token。
 * 注意：此函数仅存在于 dian115 模块，不会影响 GLaDOS / public_checkin 等其他账户类型。 */
function normalizeDian115Cookie(value: unknown): string {
  const raw = String(asString(value));
  // 去掉所有空白字符（空格、\t、\r、\n、\u00a0 等），避免复制粘贴时 JWT 被折行截断
  const cleaned = raw.replace(/\s+/g, '');
  if (!cleaned) return '';
  // 情况1/2：整段 cookie 串，只取 __Host-portal_token= 那一段
  if (cleaned.startsWith('__Host-portal_token=') || cleaned.includes('__Host-portal_token=')) {
    for (const part of cleaned.split(';')) {
      const p = part.trim();
      if (p.startsWith('__Host-portal_token=')) return p;
    }
  }
  // 情况3：只贴了裸 JWT（三节 base64url），自动补上前缀
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cleaned)) {
    return `__Host-portal_token=${cleaned}`;
  }
  // 其它无法识别的残留：原样返回（保留错误行为，由下游请求发现）
  return cleaned;
}

function validateCookie(value: unknown, required: boolean): string {
  const cookie = normalizeDian115Cookie(value);
  if (!cookie && !required) return '';
  if (!cookie || cookie.length > 8000) {
    throw new HTTPException(400, { message: 'Cookie 不能为空且不能超过 8000 个字符' });
  }
  return cookie;
}

function validateCheckinMode(value: unknown): Dian115CheckinMode {
  const mode = asString(value).trim();
  if (mode === 'lucky') return 'lucky';
  return 'normal';
}

function accountFromRow(row: AccountRow): Dian115CheckinAccount {
  return {
    id: Number(row.id),
    label: row.label,
    credentialType: row.credential_type || 'cookie',
    email: row.email ?? null,
    checkinMode: row.checkin_mode,
    checkinEnabled: Number(row.checkin_enabled) === 1,
    useProxy: Number(row.use_proxy) === 1,
    points: row.points == null ? null : Number(row.points),
    balanceUpdatedAt: row.balance_updated_at == null ? null : Number(row.balance_updated_at),
    todayRewardPoints: null,
    lastStatus: row.last_status,
    lastMessage: row.last_message,
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    status: row.status,
    lastError: row.last_error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

/**
 * 今日各账号最近一次成功签到的真实积分增量。
 * 日志时间戳按签到设置的时区折算成本地日期后比对，与公益站保持同一口径。
 */
async function listTodayDian115Rewards(db: D1Database): Promise<Map<number, number>> {
  const timezone = await getPublicCheckinTimezone(db);
  const today = formatZonedLocalDate(unixNow(), timezone);
  const rows = await dbAll<{ account_id: number; reward: number | null; executed_at: number }>(db, `
    SELECT account_id, reward, executed_at
    FROM dian115_checkin_logs
    WHERE status = 'success'
      AND reward IS NOT NULL
      AND reward > 0
    ORDER BY executed_at DESC, id DESC
  `);
  const map = new Map<number, number>();
  for (const row of rows) {
    if (formatZonedLocalDate(Number(row.executed_at), timezone) !== today) continue;
    const accountId = Number(row.account_id);
    if (!map.has(accountId)) map.set(accountId, Number(row.reward));
  }
  return map;
}

async function listAccounts(db: D1Database): Promise<Dian115CheckinAccount[]> {
  const rows = await dbAll<AccountRow>(db, 'SELECT * FROM dian115_checkin_accounts ORDER BY id ASC');
  const todayRewards = await listTodayDian115Rewards(db);
  return rows.map((row) => ({
    ...accountFromRow(row),
    todayRewardPoints: todayRewards.get(Number(row.id)) ?? null
  }));
}

function validateEmail(value: unknown): string {
  const email = asString(value).trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HTTPException(400, { message: '请输入有效的邮箱地址' });
  }
  return email;
}

function validatePassword(value: unknown): string {
  const password = asString(value).trim();
  if (!password || password.length > 200) {
    throw new HTTPException(400, { message: '密码不能为空且不能超过 200 个字符' });
  }
  return password;
}

async function createAccount(db: D1Database, input: unknown): Promise<Dian115CheckinAccount> {
  const body = asRecord(input);
  const label = validateLabel(body.label);
  const checkinMode = validateCheckinMode(body.checkinMode);
  const checkinEnabled = body.checkinEnabled !== false;
  const useProxy = body.useProxy === true;
  const credentialType: Dian115CredentialType = body.credentialType === 'password' ? 'password' : 'cookie';

  let cookieData: string;
  let email: string | null = null;
  let passwordData: string | null = null;
  if (credentialType === 'password') {
    email = validateEmail(body.email);
    const password = validatePassword(body.password);
    // 密码模式创建时立即登录，拿不到 token 则不落库，避免存入无效凭证。
    const proxyUrl = await resolveProxyUrl(db, useProxy);
    let token: string;
    try {
      token = await performLogin(proxyUrl, email, password);
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : '登录失败' });
    }
    cookieData = `__Host-portal_token=${token}`;
    passwordData = encryptPublicCheckinSecret(password);
  } else {
    cookieData = validateCookie(body.cookie, true);
  }
  const result = await dbRun(db, `
    INSERT INTO dian115_checkin_accounts (
      label, cookie_data, credential_type, email, password_data,
      checkin_mode, checkin_enabled, use_proxy, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    label,
    encryptPublicCheckinSecret(cookieData),
    credentialType,
    email,
    passwordData,
    checkinMode,
    checkinEnabled ? 1 : 0,
    useProxy ? 1 : 0,
    unixNow(),
    unixNow()
  ]);
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM dian115_checkin_accounts WHERE id = ?', [Number(result.meta.last_row_id)]);
  if (!row) throw new Error('dian115 账号创建后读取失败');
  return accountFromRow(row);
}

async function updateAccount(db: D1Database, id: number, input: unknown): Promise<Dian115CheckinAccount> {
  const current = await dbFirst<AccountRow>(db, 'SELECT * FROM dian115_checkin_accounts WHERE id = ?', [id]);
  if (!current) throw new HTTPException(404, { message: 'dian115 账号不存在' });
  const body = asRecord(input);
  const label = body.label !== undefined ? validateLabel(body.label) : current.label;
  const checkinMode = body.checkinMode !== undefined ? validateCheckinMode(body.checkinMode) : current.checkin_mode;
  const checkinEnabled = body.checkinEnabled !== undefined ? body.checkinEnabled === true : Number(current.checkin_enabled) === 1;
  const useProxy = body.useProxy !== undefined ? body.useProxy === true : Number(current.use_proxy) === 1;

  const credentialType: Dian115CredentialType = body.credentialType !== undefined
    ? (body.credentialType === 'password' ? 'password' : 'cookie')
    : (current.credential_type || 'cookie');
  let email: string | null = current.email;
  let passwordData = current.password_data;
  let cookieData: string | null = null;
  if (credentialType === 'password') {
    if (body.email !== undefined) {
      email = validateEmail(body.email);
    } else if (!current.email) {
      throw new HTTPException(400, { message: '密码模式需要提供邮箱' });
    }
    const resolvedEmail = email as string;
    if (body.password !== undefined && asString(body.password).trim() !== '') {
      const password = validatePassword(body.password);
      const proxyUrl = await resolveProxyUrl(db, useProxy);
      let token: string;
      try {
        token = await performLogin(proxyUrl, resolvedEmail, password);
      } catch (error) {
        throw new HTTPException(400, { message: error instanceof Error ? error.message : '登录失败' });
      }
      cookieData = `__Host-portal_token=${token}`;
      passwordData = encryptPublicCheckinSecret(password);
    }
    if (!passwordData) {
      throw new HTTPException(400, { message: '密码模式需要提供密码' });
    }
  } else if (body.cookie !== undefined && asString(body.cookie).trim() !== '') {
    cookieData = validateCookie(body.cookie, true);
    email = null;
    passwordData = null;
  }
  await dbRun(db, `
    UPDATE dian115_checkin_accounts
    SET label = ?,
        cookie_data = COALESCE(?, cookie_data),
        credential_type = ?,
        email = ?,
        password_data = ?,
        checkin_mode = ?,
        checkin_enabled = ?,
        use_proxy = ?,
        updated_at = ?
    WHERE id = ?
  `, [
    label,
    cookieData ? encryptPublicCheckinSecret(cookieData) : null,
    credentialType,
    email,
    passwordData,
    checkinMode,
    checkinEnabled ? 1 : 0,
    useProxy ? 1 : 0,
    unixNow(),
    id
  ]);
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM dian115_checkin_accounts WHERE id = ?', [id]);
  if (!row) throw new Error('dian115 账号更新后读取失败');
  return accountFromRow(row);
}

async function deleteAccount(db: D1Database, id: number): Promise<void> {
  const result = await dbRun(db, 'DELETE FROM dian115_checkin_accounts WHERE id = ?', [id]);
  if (!result.meta.changes) throw new HTTPException(404, { message: 'dian115 账号不存在' });
}

function invalidateAccount(db: D1Database, id: number, message: string): Promise<unknown> {
  return dbRun(db, `
    UPDATE dian115_checkin_accounts
    SET status = 'error', last_error = ?, updated_at = ?
    WHERE id = ?
  `, [message, unixNow(), id]);
}

function b64Url(buffer: Uint8Array | Buffer): string {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** P-256 公钥 SPKI DER 的尾部是 04 || x(32) || y(32)，由此手动导出 JWK。 */
function publicKeyJwk(publicKey: KeyObject): { kty: string; crv: string; x: string; y: string } {
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const point = der.subarray(der.length - 65);
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64Url(point.subarray(1, 33)),
    y: b64Url(point.subarray(33, 65))
  };
}

/** Node 的 ECDSA 签名输出 DER，浏览器 WebCrypto 输出 raw r||s，需转换。 */
function derSignatureToRaw(der: Buffer): Buffer {
  let idx = 2; // SEQUENCE header
  const readInt = (): string => {
    const len = der[idx + 1];
    const hex = der.subarray(idx + 2, idx + 2 + len).toString('hex').replace(/^00+/, '');
    idx += 2 + len;
    return hex;
  };
  const rHex = readInt();
  const sHex = readInt();
  const pad = (hex: string): Buffer => Buffer.from(hex.padStart(64, '0'), 'hex');
  return Buffer.concat([pad(rHex), pad(sHex)]);
}

/**
 * dian115 的应用层防爬（portal-browser-security v1）：
 * 1. GET /api/portal/auth/browser-challenge → 拿 proof（约 10 分钟有效）；
 * 2. 本地生成 ECDSA P-256 密钥对，POST /api/portal/auth/browser-session 提交公钥 JWK，
 *    服务器下发 __Host-portal_browser 会话 Cookie（约 30 分钟）；
 * 3. 每个业务请求对 `portal-browser-request/v1\nMETHOD\nPATH\nTS\nNONCE` 签名，
 *    通过 X-Portal-Browser-Sig/Ts/Nonce 头携带。
 * 另外站点由 Cloudflare 保护：/api/portal/* 请求必须携带 X-Portal-Browser-* 与 sec-fetch 头，
 * 否则 CF 直接 403（CF 只检查头存在性，签名有效性由应用层验证）。
 * 会话在模块级缓存，所有账号共享（browser 会话与用户登录态是两个独立维度）。
 */
interface BrowserSecurityState {
  privateKey: KeyObject;
  publicJwk: { kty: string; crv: string; x: string; y: string };
  proof: string | null;
  proofExpiresAt: number;
  browserCookie: string | null;
  sessionExpiresAt: number;
  serverTimeOffsetMs: number;
}

const DIAN115_VISITOR_ID = randomUUID();
const PROOF_EXPIRY_MARGIN_MS = 30_000;
const SESSION_EXPIRY_MARGIN_MS = 60_000;
let browserSecurity: BrowserSecurityState | null = null;
let browserSecurityPromise: Promise<BrowserSecurityState> | null = null;

function browserSecurityValid(state: BrowserSecurityState | null): boolean {
  if (!state) return false;
  const now = Date.now();
  return state.proofExpiresAt - now > PROOF_EXPIRY_MARGIN_MS && state.sessionExpiresAt - now > SESSION_EXPIRY_MARGIN_MS;
}

function resetBrowserSecurity(): void {
  browserSecurity = null;
  browserSecurityPromise = null;
}

/** CF 要求所有 /api/portal/* 请求带浏览器头，challenge/session 端点自身不验签名，用占位值过存在性检查。 */
function placeholderBrowserHeaders(): Record<string, string> {
  return {
    'x-portal-browser-proof': 'v2.0.0.00000000000000000000000000000000.00000000000000000000000000000000000000000000',
    'x-portal-browser-ts': String(Date.now()),
    'x-portal-browser-nonce': b64Url(randomBytes(24)),
    'x-portal-browser-sig': b64Url(randomBytes(64))
  };
}

interface PortalHttpResponse {
  status: number;
  payload: Record<string, unknown> | null;
  setCookie: string[];
}

async function portalHttp(
  pathname: string,
  options: { method?: 'GET' | 'POST'; body?: string; extraHeaders?: Record<string, string>; cookie: string; proxyUrl?: string }
): Promise<PortalHttpResponse> {
  const url = new URL(`${DIAN115_URL}${pathname}`);
  const headers: Record<string, string> = {
    'user-agent': DIAN115_UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-requested-with': 'XMLHttpRequest',
    'x-portal-visitor-id': DIAN115_VISITOR_ID,
    'x-portal-current-path': '/app/signin',
    'x-portal-browser-proof': 'v2.0.0.00000000000000000000000000000000.00000000000000000000000000000000000000000000',
    'x-portal-browser-ts': String(Date.now()),
    'x-portal-browser-nonce': b64Url(randomBytes(24)),
    'x-portal-browser-sig': b64Url(randomBytes(64)),
    cookie: options.cookie,
    ...(options.extraHeaders || {})
  };
  const isPost = options.method === 'POST';
  if (isPost) {
    headers['content-type'] = 'application/json';
    headers.origin = DIAN115_URL;
    headers.referer = `${DIAN115_URL}/me/signin`;
  } else {
    headers.referer = `${DIAN115_URL}/app/signin`;
  }
  const dispatcher = options.proxyUrl ? getProxyDispatcher(options.proxyUrl) : undefined;
  let response: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    response = await requestFetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(DIAN115_TIMEOUT_MS),
      dispatcher
    } as UndiciRequestInit);
  } catch (error) {
    throw new Error(`站点请求失败：${error instanceof Error ? error.message : '网络异常'}`);
  }
  const contentType = asString(response.headers.get('content-type'));
  const text = await response.text();
  if (contentType.includes('text/html')) {
    throw new Error(`被 Cloudflare 拦截（HTTP ${response.status}）：请稍后重试，若持续出现请检查服务器出口 IP 是否被限制`);
  }
  let payload: Record<string, unknown> | null = null;
  try {
    payload = asRecord(JSON.parse(text));
  } catch {
    throw new Error(`站点响应格式无效（HTTP ${response.status}）`);
  }
  return {
    status: response.status,
    payload,
    setCookie: (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || []
  };
}

async function ensureBrowserSecurity(proxyUrl: string): Promise<BrowserSecurityState> {
  if (browserSecurityValid(browserSecurity)) return browserSecurity!;
  if (browserSecurityPromise) return browserSecurityPromise;
  browserSecurityPromise = (async () => {
    // Step 1: challenge 拿 proof
    const challengeResp = await portalHttp('/api/portal/auth/browser-challenge', { cookie: '', proxyUrl });
    const challenge = challengeResp.payload || {};
    const proof = asString(challenge.proof).trim();
    if (challengeResp.status !== 200 || !proof) {
      throw new Error(asString(challenge.msg).trim() || `获取浏览器验证失败（HTTP ${challengeResp.status}）`);
    }
    const ttl = Number(challenge.ttl) || 600;
    const expiresAt = challenge.expires_at ? Date.parse(asString(challenge.expires_at)) : Date.now() + ttl * 1000;

    // Step 2: 生成密钥对并注册公钥，换取浏览器会话 Cookie
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicJwk = publicKeyJwk(publicKey);
    const sessionResp = await portalHttp('/api/portal/auth/browser-session', {
      method: 'POST',
      body: JSON.stringify({ public_jwk: publicJwk }),
      extraHeaders: { 'x-portal-browser-proof': proof },
      cookie: '',
      proxyUrl
    });
    const session = sessionResp.payload || {};
    if (sessionResp.status !== 200 || session.enabled === false) {
      throw new Error(asString(session.msg).trim() || `浏览器会话建立失败（HTTP ${sessionResp.status}）`);
    }
    let browserCookie: string | null = null;
    for (const cookie of sessionResp.setCookie) {
      const pair = cookie.split(';')[0];
      if (pair.startsWith('__Host-portal_browser=')) browserCookie = pair.trim();
    }
    const serverTimeMs = Number(session.server_time_ms);
    const serverTimeOffsetMs = Number.isFinite(serverTimeMs) ? serverTimeMs - Date.now() : 0;
    const sessionTtl = Number(session.ttl) || 1800;
    const sessionExpiresAt = session.expires_at
      ? Date.parse(asString(session.expires_at)) - serverTimeOffsetMs
      : Date.now() + sessionTtl * 1000;

    browserSecurity = {
      privateKey,
      publicJwk,
      proof,
      proofExpiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + ttl * 1000,
      browserCookie,
      sessionExpiresAt: Number.isFinite(sessionExpiresAt) ? sessionExpiresAt : Date.now() + sessionTtl * 1000,
      serverTimeOffsetMs
    };
    return browserSecurity;
  })().finally(() => {
    browserSecurityPromise = null;
  });
  return browserSecurityPromise;
}

function browserSignHeaders(state: BrowserSecurityState, method: string, path: string): Record<string, string> {
  const timestamp = String(Date.now() + state.serverTimeOffsetMs);
  const nonce = b64Url(randomBytes(24));
  const message = `portal-browser-request/v1\n${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}`;
  const der = cryptoSign('sha256', Buffer.from(message), state.privateKey);
  const raw = derSignatureToRaw(der);
  return {
    'x-portal-browser-proof': state.proof || '',
    'x-portal-browser-ts': timestamp,
    'x-portal-browser-nonce': nonce,
    'x-portal-browser-sig': b64Url(raw)
  };
}

/**
 * 邮箱密码自动登录：成功后返回新的 __Host-portal_token 值。
 * 登录会换发浏览器会话 Cookie，所以登录后必须 reset 会话，
 * 下一个业务请求会重新走 challenge+session 建立与签名匹配的会话。
 */
async function performLogin(proxyUrl: string, email: string, password: string): Promise<string> {
  resetBrowserSecurity();
  const state = await ensureBrowserSecurity(proxyUrl);
  const resp = await portalHttp('/api/portal/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    extraHeaders: browserSignHeaders(state, 'POST', '/api/portal/auth/login'),
    // 登录请求必须携带 browser-session 下发的会话 Cookie，否则签名无法关联到会话。
    cookie: state.browserCookie || '',
    proxyUrl
  });
  const payload = resp.payload || {};
  if (resp.status !== 200 || asString(payload.code).trim() !== 'ok') {
    throw new Error(asString(payload.msg).trim() || `登录失败（HTTP ${resp.status}）`);
  }
  for (const cookie of resp.setCookie) {
    const pair = cookie.split(';')[0];
    if (pair.startsWith('__Host-portal_token=')) {
      resetBrowserSecurity();
      return pair.slice('__Host-portal_token='.length).trim();
    }
  }
  // 兼容未通过 Set-Cookie 下发的情形：拿 me 兑换 token 不可行，直接报错。
  throw new Error('登录成功但未下发会话 Cookie，请改用 Cookie 方式接入');
}

/**
 * dian115 业务请求：自动携带浏览器安全头与签名会话；
 * 收到 browser_proof_required/invalid 时重置会话并重试一次（与站点前端行为一致）。
 * 响应约定：
 * - 200 + code "ok"：成功
 * - 409 + code "already_signed"：今日已签到
 * - browser_proof_required/invalid：会话失效（内部重试）
 * - 其余 code/msg：业务错误
 */
async function dian115Request(
  pathname: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; cookie: string; proxyUrl?: string }
): Promise<{ status: number; payload: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const state = await ensureBrowserSecurity(options.proxyUrl || '');
    const isPost = options.method === 'POST';
    const fullCookie = [options.cookie, state.browserCookie].filter(Boolean).join('; ');
    const resp = await portalHttp(pathname, {
      method: options.method,
      body: isPost ? JSON.stringify(options.body || {}) : undefined,
      extraHeaders: browserSignHeaders(state, options.method || 'GET', pathname),
      cookie: fullCookie,
      proxyUrl: options.proxyUrl
    });
    const payload = resp.payload || {};
    const code = asString(payload.code).trim();
    if ((code === 'browser_proof_required' || code === 'browser_proof_invalid') && attempt === 0) {
      resetBrowserSecurity();
      continue;
    }
    return { status: resp.status, payload };
  }
  throw new Error('浏览器验证会话无法建立，站点可能已更新防爬机制');
}

function profileFromMePayload(payload: Record<string, unknown>): Dian115UserProfile | null {
  const user = asRecord(payload.user);
  if (!Object.keys(user).length) return null;
  return {
    email: asString(user.email).trim(),
    nickname: asString(user.nickname).trim(),
    points: finiteNumber(user.points),
    lastSigninDate: asString(user.last_signin_date).trim() || null
  };
}

/** 应用层错误，携带站点 code，便于上层区分「登录态失效」与普通业务失败。 */
class Dian115ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'Dian115ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 拉取当前用户信息（昵称、邮箱、积分、最近签到日期），用于连接检测与余额刷新。 */
async function fetchProfile(cookie: string, proxyUrl: string): Promise<Dian115UserProfile> {
  const { status, payload } = await dian115Request('/api/portal/me', { cookie, proxyUrl });
  const profile = profileFromMePayload(payload);
  if (!profile) {
    const code = asString(payload.code).trim();
    throw new Dian115ApiError(
      asString(payload.msg).trim() || `站点返回 HTTP ${status}，无法读取用户信息`,
      code,
      status
    );
  }
  return profile;
}

interface Dian115SigninResponse {
  /** success = 签到成功；repeat = 今日已签到。 */
  outcome: 'success' | 'repeat';
  message: string;
}

/**
 * 执行签到。响应约定（来自站点 HAR 抓包）：
 * - 200 + code "ok"：签到成功
 * - 409 + code "already_signed"：今日已签到
 * - 其余 code/msg：签到失败
 */
async function signin(cookie: string, mode: Dian115CheckinMode, proxyUrl: string): Promise<Dian115SigninResponse> {
  const { status, payload } = await dian115Request('/api/portal/signin', {
    method: 'POST',
    body: { mode },
    cookie,
    proxyUrl
  });
  const code = asString(payload.code).trim();
  const message = asString(payload.msg).trim() || asString(payload.message).trim();
  if (code === 'ok') return { outcome: 'success', message: message || '签到成功' };
  if (code === 'already_signed' || status === 409) {
    return { outcome: 'repeat', message: message || '今日已签到' };
  }
  throw new Dian115ApiError(message || `签到失败（HTTP ${status}）`, code, status);
}

async function insertLog(db: D1Database, input: {
  accountId: number;
  triggeredBy: Dian115CheckinTriggeredBy;
  status: Dian115CheckinLogStatus;
  reward?: number | null;
  rewardNote?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await dbRun(db, `
    INSERT INTO dian115_checkin_logs (account_id, triggered_by, status, reward, reward_note, error_message, executed_at)
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

function upsertAccountAfterRun(db: D1Database, accountId: number, input: {
  points?: number | null;
  lastStatus: Dian115CheckinStatus;
  lastMessage: string | null;
  status: Dian115CheckinAccountStatus;
  lastError: string | null;
}): Promise<unknown> {
  return dbRun(db, `
    UPDATE dian115_checkin_accounts
    SET points = COALESCE(?, points),
        balance_updated_at = CASE WHEN ? IS NOT NULL THEN ? ELSE balance_updated_at END,
        last_status = ?, last_message = ?, last_run_at = ?, status = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `, [
    input.points ?? null,
    input.points ?? null,
    unixNow(),
    input.lastStatus,
    input.lastMessage,
    unixNow(),
    input.status,
    input.lastError,
    unixNow(),
    accountId
  ]);
}

/**
 * 对单个 dian115 账号执行完整签到流程：签到 -> 查询积分，计算本次奖励。
 * 返回与公益站汇总通知兼容的形状（PublicCheckinNotificationItem 子集）。
 */
/** 判断业务错误是否属于登录态失效，密码模式可自动重登。 */
function isTokenInvalidError(error: unknown): boolean {
  if (!(error instanceof Dian115ApiError)) return false;
  return error.code === 'invalid_token' || error.code === 'token_revoked' || error.code === 'no_token'
    || error.code === 'unauthorized' || error.status === 401;
}

/**
 * 带登录态的请求封装：密码模式遇 token 失效时自动重新登录、落库新 token 并重试一次。
 * cookie 模式遇到同样错误则直接抛出，提示用户更新 Cookie。
 */
async function withAccountToken<T>(
  db: D1Database,
  row: AccountRow,
  proxyUrl: string,
  task: (cookie: string) => Promise<T>
): Promise<T> {
  const cookie = decryptPublicCheckinSecret(row.cookie_data);
  try {
    return await task(cookie);
  } catch (error) {
    if ((row.credential_type || 'cookie') !== 'password' || !isTokenInvalidError(error)) throw error;
    const email = asString(row.email).trim();
    const password = decryptPublicCheckinSecret(row.password_data || '');
    if (!email || !password) throw error;
    const token = await performLogin(proxyUrl, email, password);
    const newCookie = `__Host-portal_token=${token}`;
    await dbRun(db, `
      UPDATE dian115_checkin_accounts
      SET cookie_data = ?, updated_at = ?
      WHERE id = ?
    `, [encryptPublicCheckinSecret(newCookie), unixNow(), Number(row.id)]);
    return await task(newCookie);
  }
}

export async function runDian115CheckinForAccount(
  db: D1Database,
  accountId: number,
  triggeredBy: Dian115CheckinTriggeredBy
): Promise<Dian115CheckinRunResult> {
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM dian115_checkin_accounts WHERE id = ?', [accountId]);
  if (!row) return { accountId, label: '-', siteName: 'dian115', result: { success: false, status: 'failed', errorMessage: '账号不存在' } };
  if (row.status === 'disabled' || row.checkin_enabled !== 1) {
    const errorMessage = row.status === 'disabled' ? '账号已禁用' : '账号未启用自动签到';
    await insertLog(db, { accountId, triggeredBy, status: 'skipped', errorMessage });
    return { accountId, label: row.label, siteName: 'dian115', result: { success: true, status: 'skipped', errorMessage: '账号已跳过' } };
  }

  const proxyUrl = await resolveProxyUrl(db, Number(row.use_proxy) === 1);
  let pointsBefore: number | null = null;
  let points: number | null = null;
  const notes: string[] = [];

  try {
    try {
      pointsBefore = await withAccountToken(db, row, proxyUrl, (cookie) => fetchProfile(cookie, proxyUrl).then((p) => p.points));
    } catch {
      // 签到前积分查询失败时回退到库中上次记录，仍能估算增量。
    }
    if (pointsBefore == null) pointsBefore = row.points == null ? null : Number(row.points);

    const signinResult = await withAccountToken(db, row, proxyUrl, (cookie) => signin(cookie, row.checkin_mode, proxyUrl));

    let pointsError: string | null = null;
    try {
      points = await withAccountToken(db, row, proxyUrl, (cookie) => fetchProfile(cookie, proxyUrl).then((p) => p.points));
    } catch (error) {
      pointsError = error instanceof Error ? error.message : '未知错误';
    }
    const earned = pointsBefore != null && points != null ? points - pointsBefore : null;

    let checkinStatus: Dian115CheckinStatus;
    let reward: number | null = null;

    if (signinResult.outcome === 'success') {
      checkinStatus = 'success';
      reward = earned != null && earned > 0 ? earned : null;
      notes.push(reward == null ? '签到成功' : `签到成功，获得 ${reward} 积分`);
    } else {
      checkinStatus = 'repeat';
      notes.push('今日已签到（重复）');
    }

    if (pointsError) notes.push(`积分查询失败：${pointsError}`);

    // signin 失败会直接抛出进入 catch，走到这里的一定是签到成功或今日已签到。
    await upsertAccountAfterRun(db, accountId, {
      points,
      lastStatus: checkinStatus,
      lastMessage: notes.join('；'),
      status: 'active',
      lastError: null
    });
    await insertLog(db, {
      accountId,
      triggeredBy,
      status: 'success',
      reward,
      rewardNote: notes.join('；') || null,
      errorMessage: null
    });

    return {
      accountId,
      label: row.label,
      siteName: 'dian115',
      result: {
        success: true,
        status: 'success',
        reward: reward ?? null,
        rewardNote: notes.join('；') || null,
        errorMessage: null,
        balanceBefore: pointsBefore,
        balanceAfter: points
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '签到失败';
    await upsertAccountAfterRun(db, accountId, {
      points,
      lastStatus: 'failed',
      lastMessage: message,
      status: 'error',
      lastError: message
    });
    await insertLog(db, { accountId, triggeredBy, status: 'failed', errorMessage: message });
    return { accountId, label: row.label, siteName: 'dian115', result: { success: false, status: 'failed', errorMessage: message } };
  }
}

export async function runDian115CheckinAll(
  db: D1Database,
  triggeredBy: Dian115CheckinTriggeredBy
): Promise<Dian115CheckinRunResult[]> {
  const accounts = await dbAll<AccountRow>(
    db,
    "SELECT * FROM dian115_checkin_accounts WHERE checkin_enabled = 1 AND status <> 'disabled' ORDER BY id ASC"
  );
  const results: Dian115CheckinRunResult[] = [];
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    results.push(await runDian115CheckinForAccount(db, Number(account.id), triggeredBy));
    if (index < accounts.length - 1) await sleep(betweenAccountsDelayMs);
  }
  return results;
}

function buildTestResult(profile: Dian115UserProfile): Dian115TestResult {
  return {
    success: true,
    message: '连接正常',
    nickname: profile.nickname || undefined,
    email: profile.email || undefined,
    points: profile.points,
    lastSigninDate: profile.lastSigninDate
  };
}

/**
 * 未保存凭据的连接检测（添加账号弹框里的「检测连接」按钮）。
 * 支持两种方式：直接填 Cookie，或填邮箱密码（自动登录后验证），只读 /api/portal/me，不触发签到。
 */
export async function testDian115Cookie(
  db: D1Database,
  input: unknown
): Promise<Dian115TestResult> {
  const body = asRecord(input);
  const proxyUrl = await resolveProxyUrl(db, body.useProxy === true);
  try {
    let profile: Dian115UserProfile;
    if (body.credentialType === 'password' || (asString(body.cookie).trim() === '' && asString(body.email).trim() !== '')) {
      const email = validateEmail(body.email);
      const password = validatePassword(body.password);
      const token = await performLogin(proxyUrl, email, password);
      profile = await fetchProfile(`__Host-portal_token=${token}`, proxyUrl);
    } else {
      const cookie = validateCookie(body.cookie, true);
      profile = await fetchProfile(cookie, proxyUrl);
    }
    return buildTestResult(profile);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '连接失败' };
  }
}

export async function testDian115Connection(db: D1Database, accountId: number): Promise<Dian115TestResult> {
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM dian115_checkin_accounts WHERE id = ?', [accountId]);
  if (!row) throw new HTTPException(404, { message: 'dian115 账号不存在' });
  const proxyUrl = await resolveProxyUrl(db, Number(row.use_proxy) === 1);
  try {
    const profile = await withAccountToken(db, row, proxyUrl, (cookie) => fetchProfile(cookie, proxyUrl));
    // 检测成功时同步落库，让列表无需再点一次「余额」就能看到最新积分。
    await dbRun(db, `
      UPDATE dian115_checkin_accounts
      SET points = ?, balance_updated_at = ?, status = 'active', last_error = NULL, updated_at = ?
      WHERE id = ?
    `, [profile.points, unixNow(), unixNow(), accountId]);
    return buildTestResult(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : '连接失败';
    await invalidateAccount(db, accountId, message);
    return { success: false, message };
  }
}

function positiveInt(value: string | null): number {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? Math.trunc(parsed) : 0;
}

/**
 * 与 `/api/public-checkin/glados/logs` 保持同一套查询参数与响应形状（含 accountLabel/siteName），
 * 前端「签到日志」弹框因此可以直接复用同一份表格列定义与筛选控件。
 */
async function listLogs(db: D1Database, queryInput: URLSearchParams): Promise<Dian115CheckinLogResponse> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const accountId = positiveInt(queryInput.get('accountId'));
  if (accountId) {
    conditions.push('l.account_id = ?');
    values.push(accountId);
  }
  const status = queryInput.get('status');
  if (status === 'success' || status === 'failed' || status === 'skipped') {
    conditions.push('l.status = ?');
    values.push(status);
  }
  const startAt = positiveInt(queryInput.get('startAt'));
  if (startAt) {
    conditions.push('l.executed_at >= ?');
    values.push(startAt);
  }
  const endAt = positiveInt(queryInput.get('endAt'));
  if (endAt) {
    conditions.push('l.executed_at <= ?');
    values.push(endAt);
  }
  const limit = Math.min(Math.max(positiveInt(queryInput.get('limit')) || 50, 1), 200);
  const offset = Math.max(positiveInt(queryInput.get('offset')), 0);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await dbAll<LogRow & { account_label: string }>(db, `
    SELECT l.*, a.label AS account_label
    FROM dian115_checkin_logs l
    INNER JOIN dian115_checkin_accounts a ON a.id = l.account_id
    ${where}
    ORDER BY l.executed_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `, [...values, limit, offset]);
  const totalRow = await dbFirst<{ count: number }>(db, `
    SELECT COUNT(*) AS count
    FROM dian115_checkin_logs l
    ${where}
  `, values);

  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      accountId: Number(row.account_id),
      triggeredBy: row.triggered_by,
      status: row.status,
      reward: row.reward == null ? null : Number(row.reward),
      rewardNote: row.reward_note,
      errorMessage: row.error_message,
      executedAt: Number(row.executed_at),
      accountLabel: row.account_label,
      siteName: 'dian115'
    })),
    total: Number(totalRow?.count || 0),
    limit,
    offset
  };
}

export function registerDian115CheckinRoutes(app: Hono<any>): void {
  app.get('/api/public-checkin/dian115/accounts', async (c) => c.json(await listAccounts(c.env.DB)));
  app.post('/api/public-checkin/dian115/accounts', async (c) => c.json(await createAccount(c.env.DB, await readBody(c)), 201));
  app.put('/api/public-checkin/dian115/accounts/:id', async (c) => c.json(await updateAccount(c.env.DB, routeId(c.req.param('id')), await readBody(c))));
  app.delete('/api/public-checkin/dian115/accounts/:id', async (c) => {
    await deleteAccount(c.env.DB, routeId(c.req.param('id')));
    return c.body(null, 204);
  });
  app.get('/api/public-checkin/dian115/accounts/:id/credential', async (c) => {
    const row = await dbFirst<AccountRow>(c.env.DB, 'SELECT * FROM dian115_checkin_accounts WHERE id = ?', [routeId(c.req.param('id'))]);
    if (!row) throw new HTTPException(404, { message: 'dian115 账号不存在' });
    return c.json({ cookie: decryptPublicCheckinSecret(row.cookie_data) });
  });
  app.post('/api/public-checkin/dian115/test', async (c) => c.json(await testDian115Cookie(c.env.DB, await readBody(c))));
  app.post('/api/public-checkin/dian115/accounts/:id/test', async (c) => c.json(await testDian115Connection(c.env.DB, routeId(c.req.param('id')))));
  app.post('/api/public-checkin/dian115/accounts/:id/checkin', async (c) => c.json(await runDian115CheckinForAccount(c.env.DB, routeId(c.req.param('id')), 'manual')));
  app.post('/api/public-checkin/dian115/accounts/:id/refresh-balance', async (c) => c.json(await testDian115Connection(c.env.DB, routeId(c.req.param('id')))));
  app.get('/api/public-checkin/dian115/logs', async (c) => c.json(await listLogs(c.env.DB, new URL(c.req.url).searchParams)));
}

export const dian115CheckinTestHooks = {
  setFetch(fetchImpl: typeof undiciFetch | null): void {
    requestFetch = fetchImpl || undiciFetch;
  },
  setTiming(input: { betweenAccountsDelayMs?: number }): void {
    if (input.betweenAccountsDelayMs != null) betweenAccountsDelayMs = input.betweenAccountsDelayMs;
  },
  reset(): void {
    requestFetch = undiciFetch;
    betweenAccountsDelayMs = 1_000;
    resetBrowserSecurity();
  }
};