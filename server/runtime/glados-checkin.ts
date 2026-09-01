import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
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

export type GladosCheckinTriggeredBy = 'scheduler' | 'manual';
export type GladosCheckinStatus = 'success' | 'repeat' | 'failed';
export type GladosCheckinLogStatus = 'success' | 'failed' | 'skipped';
export type GladosCheckinAccountStatus = 'active' | 'disabled' | 'error';
export type GladosExchangePlan = 'plan100' | 'plan200' | 'plan500';

export interface GladosCheckinAccount {
  id: number;
  label: string;
  exchangeEnabled: boolean;
  exchangePlan: GladosExchangePlan | null;
  checkinEnabled: boolean;
  useProxy: boolean;
  points: number | null;
  leftDays: number | null;
  balanceUpdatedAt: number | null;
  /** 今日最近一次成功签到实际获得的积分，来自 glados_checkin_logs，无记录为 null。 */
  todayRewardPoints: number | null;
  subscriptionUrl: string | null;
  expiresAt: number | null;
  trafficUsedBytes: number | null;
  trafficLimitGb: number | null;
  planLevel: string | null;
  lastStatus: GladosCheckinStatus | null;
  lastMessage: string | null;
  lastRunAt: number | null;
  status: GladosCheckinAccountStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GladosCheckinLog {
  id: number;
  accountId: number;
  triggeredBy: GladosCheckinTriggeredBy;
  status: GladosCheckinLogStatus;
  reward: number | null;
  rewardNote: string | null;
  errorMessage: string | null;
  executedAt: number;
  accountLabel: string;
  siteName: string;
}

export interface GladosCheckinLogResponse {
  items: GladosCheckinLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface GladosTestResult {
  success: boolean;
  message: string;
  email?: string;
  leftDays?: number | null;
  points?: number | null;
  subscriptionUrl?: string | null;
  expiresAt?: number | null;
  trafficUsedBytes?: number | null;
  trafficLimitGb?: number | null;
  planLevel?: string | null;
}

/** 从 /api/user/status 与 /api/user/traffic 派生出的账号快照，用于统一写库。 */
interface GladosAccountSnapshot {
  leftDays: number | null;
  subscriptionUrl: string | null;
  expiresAt: number | null;
  trafficLimitGb: number | null;
  planLevel: string | null;
}

interface AccountRow {
  id: number;
  label: string;
  cookie_data: string;
  exchange_enabled: number;
  exchange_plan: GladosExchangePlan | null;
  checkin_enabled: number;
  use_proxy: number;
  points: number | null;
  left_days: number | null;
  balance_updated_at: number | null;
  subscription_url: string | null;
  expires_at: number | null;
  traffic_used_bytes: number | null;
  traffic_limit_gb: number | null;
  plan_level: string | null;
  last_status: GladosCheckinStatus | null;
  last_message: string | null;
  last_run_at: number | null;
  status: GladosCheckinAccountStatus;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface LogRow {
  id: number;
  account_id: number;
  triggered_by: GladosCheckinTriggeredBy;
  status: GladosCheckinLogStatus;
  reward: number | null;
  reward_note: string | null;
  error_message: string | null;
  executed_at: number;
}

const GLADOS_URL = 'https://glados.cloud';
const GLADOS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36';
const GLADOS_TIMEOUT_MS = 30_000;
const SYSTEM_PROXY_CONFIG_KEY = 'system_proxy_config';
const EXCHANGE_PLAN_POINTS: Record<GladosExchangePlan, number> = {
  plan100: 100,
  plan200: 200,
  plan500: 500
};
const BASE_GLADOS_POINTS: Record<GladosExchangePlan, string> = {
  plan100: '10 天',
  plan200: '30 天',
  plan500: '100 天'
};

/**
 * 订阅链接由站点前端拼接而成，没有任何接口直接返回它。
 * 模板取自 glados.cloud 的前端 chunk：
 *   `https://${host}/mihomo/${user_id}/${code}/${port}/glados.yaml`
 * 三段参数全部来自我们已经在调用的 /api/user/status。
 */
const GLADOS_SUBSCRIPTION_HOST = 'update.glados-config.com';
const BYTES_PER_GB = 1_073_741_824;

/**
 * vip 等级 -> 套餐名与每月流量额度（GB），同样取自站点前端 chunk 的映射逻辑。
 * 站点默认分支为 Basic/0，此处保持一致。
 */
const VIP_PLAN_MAP: Record<number, { level: string; limitGb: number }> = {
  0: { level: 'Free', limitGb: 10 },
  10: { level: 'Free', limitGb: 10 },
  11: { level: 'Edu', limitGb: 100 },
  21: { level: 'Basic', limitGb: 200 },
  31: { level: 'Pro', limitGb: 500 },
  41: { level: 'Team', limitGb: 2000 },
  51: { level: 'Enterprise', limitGb: 5000 }
};
const DEFAULT_VIP_PLAN = { level: 'Basic', limitGb: 0 };

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

function nonNegativeInt(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed == null || parsed < 0 ? null : Math.trunc(parsed);
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

/**
 * 与公益站账号一致：只有账号显式开启 useProxy 时才走系统代理，默认直连。
 * 系统代理的规则集未必覆盖 glados.cloud，强制走代理会导致 TLS 握手前被断开。
 */
async function resolveProxyUrl(db: D1Database, useProxy: boolean): Promise<string> {
  if (!useProxy) return '';
  const configured = await getSystemProxyUrl(db);
  return configured.trim();
}

const gladosProxyAgentCache = new Map<string, Dispatcher>();

function getProxyDispatcher(proxyUrl: string): Dispatcher | undefined {
  const resolved = proxyUrl.trim();
  if (!resolved) return undefined;
  let agent = gladosProxyAgentCache.get(resolved);
  if (!agent) {
    agent = new ProxyAgent(resolved);
    gladosProxyAgentCache.set(resolved, agent);
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

function validateCookie(value: unknown, required: boolean): string {
  const cookie = asString(value).trim();
  if (!cookie && !required) return '';
  if (!cookie || cookie.length > 8000) {
    throw new HTTPException(400, { message: 'Cookie 不能为空且不能超过 8000 个字符' });
  }
  return cookie;
}

function validateExchangePlan(value: unknown): GladosExchangePlan | null {
  const plan = asString(value).trim();
  if (!plan) return null;
  if (plan !== 'plan100' && plan !== 'plan200' && plan !== 'plan500') {
    throw new HTTPException(400, { message: '无效的积分兑换计划' });
  }
  return plan;
}

function accountFromRow(row: AccountRow): GladosCheckinAccount {
  return {
    id: Number(row.id),
    label: row.label,
    exchangeEnabled: Number(row.exchange_enabled) === 1,
    exchangePlan: row.exchange_plan,
    checkinEnabled: Number(row.checkin_enabled) === 1,
    useProxy: Number(row.use_proxy) === 1,
    points: row.points == null ? null : Number(row.points),
    leftDays: row.left_days == null ? null : Number(row.left_days),
    balanceUpdatedAt: row.balance_updated_at == null ? null : Number(row.balance_updated_at),
    todayRewardPoints: null,
    subscriptionUrl: row.subscription_url,
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    trafficUsedBytes: row.traffic_used_bytes == null ? null : Number(row.traffic_used_bytes),
    trafficLimitGb: row.traffic_limit_gb == null ? null : Number(row.traffic_limit_gb),
    planLevel: row.plan_level,
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
async function listTodayGladosRewards(db: D1Database): Promise<Map<number, number>> {
  const timezone = await getPublicCheckinTimezone(db);
  const today = formatZonedLocalDate(unixNow(), timezone);
  const rows = await dbAll<{ account_id: number; reward: number | null; executed_at: number }>(db, `
    SELECT account_id, reward, executed_at
    FROM glados_checkin_logs
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

async function listAccounts(db: D1Database): Promise<GladosCheckinAccount[]> {
  const rows = await dbAll<AccountRow>(db, 'SELECT * FROM glados_checkin_accounts ORDER BY id ASC');
  const todayRewards = await listTodayGladosRewards(db);
  return rows.map((row) => ({
    ...accountFromRow(row),
    todayRewardPoints: todayRewards.get(Number(row.id)) ?? null
  }));
}

async function createAccount(db: D1Database, input: unknown): Promise<GladosCheckinAccount> {
  const body = asRecord(input);
  const label = validateLabel(body.label);
  const cookie = validateCookie(body.cookie, true);
  const exchangeEnabled = body.exchangeEnabled === true;
  const exchangePlan = exchangeEnabled
    ? validateExchangePlan(body.exchangePlan) ?? 'plan500'
    : null;
  const checkinEnabled = body.checkinEnabled !== false;
  const useProxy = body.useProxy === true;
  const result = await dbRun(db, `
    INSERT INTO glados_checkin_accounts (
      label, cookie_data, exchange_enabled, exchange_plan, checkin_enabled, use_proxy, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    label,
    encryptPublicCheckinSecret(cookie),
    exchangeEnabled ? 1 : 0,
    exchangePlan,
    checkinEnabled ? 1 : 0,
    useProxy ? 1 : 0,
    unixNow(),
    unixNow()
  ]);
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM glados_checkin_accounts WHERE id = ?', [Number(result.meta.last_row_id)]);
  if (!row) throw new Error('GLaDOS 账号创建后读取失败');
  return accountFromRow(row);
}

async function updateAccount(db: D1Database, id: number, input: unknown): Promise<GladosCheckinAccount> {
  const current = await dbFirst<AccountRow>(db, 'SELECT * FROM glados_checkin_accounts WHERE id = ?', [id]);
  if (!current) throw new HTTPException(404, { message: 'GLaDOS 账号不存在' });
  const body = asRecord(input);
  const label = body.label !== undefined ? validateLabel(body.label) : current.label;
  const cookie = body.cookie !== undefined && body.cookie !== '' ? validateCookie(body.cookie, true) : null;
  const exchangeEnabled = body.exchangeEnabled !== undefined ? body.exchangeEnabled === true : Number(current.exchange_enabled) === 1;
  const exchangePlan =
    body.exchangePlan !== undefined || body.exchangeEnabled !== undefined
      ? exchangeEnabled
        ? validateExchangePlan(body.exchangePlan ?? current.exchange_plan) ?? 'plan500'
        : null
      : current.exchange_plan;
  const checkinEnabled = body.checkinEnabled !== undefined ? body.checkinEnabled === true : Number(current.checkin_enabled) === 1;
  const useProxy = body.useProxy !== undefined ? body.useProxy === true : Number(current.use_proxy) === 1;
  await dbRun(db, `
    UPDATE glados_checkin_accounts
    SET label = ?, cookie_data = COALESCE(?, cookie_data), exchange_enabled = ?, exchange_plan = ?,
        checkin_enabled = ?, use_proxy = ?, updated_at = ?
    WHERE id = ?
  `, [
    label,
    cookie ? encryptPublicCheckinSecret(cookie) : null,
    exchangeEnabled ? 1 : 0,
    exchangePlan,
    checkinEnabled ? 1 : 0,
    useProxy ? 1 : 0,
    unixNow(),
    id
  ]);
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM glados_checkin_accounts WHERE id = ?', [id]);
  if (!row) throw new Error('GLaDOS 账号更新后读取失败');
  return accountFromRow(row);
}

async function deleteAccount(db: D1Database, id: number): Promise<void> {
  const result = await dbRun(db, 'DELETE FROM glados_checkin_accounts WHERE id = ?', [id]);
  if (!result.meta.changes) throw new HTTPException(404, { message: 'GLaDOS 账号不存在' });
}

function invalidateAccount(db: D1Database, id: number, message: string): Promise<unknown> {
  return dbRun(db, `
    UPDATE glados_checkin_accounts
    SET status = 'error', last_error = ?, updated_at = ?
    WHERE id = ?
  `, [message, unixNow(), id]);
}

async function gladosRequest(
  pathname: string,
  options: { method?: 'GET' | 'POST'; fields?: Record<string, string | number>; cookie: string; proxyUrl?: string }
): Promise<Record<string, unknown>> {
  const url = new URL(`${GLADOS_URL}${pathname}`);
  const headers: Record<string, string> = {
    origin: GLADOS_URL,
    'user-agent': GLADOS_UA,
    cookie: options.cookie,
    accept: 'application/json, text/plain, */*'
  };
  let body: string | undefined;
  if (options.method === 'POST') {
    body = new URLSearchParams(
      Object.entries(options.fields || {}).map(([key, value]) => [key, String(value)])
    ).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  const dispatcher = options.proxyUrl ? getProxyDispatcher(options.proxyUrl) : undefined;
  let response: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    response = await requestFetch(url, {
      method: options.method || 'GET',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(GLADOS_TIMEOUT_MS),
      dispatcher
    } as UndiciRequestInit);
  } catch (error) {
    throw new Error(`站点请求失败：${error instanceof Error ? error.message : '网络异常'}`);
  }
  if (response.status === 302) throw new Error('登录已失效，请重新登录 GLaDOS 网站获取新的 Cookie');
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`站点响应格式无效（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(`站点返回 HTTP ${response.status}`);
  }
  return asRecord(payload);
}

function responseError(payload: Record<string, unknown>, fallback: string): string {
  return asString(payload.message).trim() || asString(payload.msg).trim() || fallback;
}

async function fetchStatus(cookie: string, proxyUrl: string): Promise<Record<string, unknown>> {
  const payload = await gladosRequest('/api/user/status', { cookie, proxyUrl });
  return asRecord(payload.data);
}

function statusLeftDays(status: Record<string, unknown>): number | null {
  const raw = finiteNumber(status.leftDays);
  if (raw == null) return null;
  return Math.max(0, Math.trunc(raw));
}

/** 拼出 Mihomo / Clash Meta 订阅链接；缺少任一参数时返回 null，不产出半截地址。 */
function buildSubscriptionUrl(status: Record<string, unknown>): string | null {
  const userId = nonNegativeInt(status.userId ?? status.configureId);
  const code = asString(status.code).trim();
  const port = nonNegativeInt(status.port);
  if (userId == null || !code || port == null) return null;
  return `https://${GLADOS_SUBSCRIPTION_HOST}/mihomo/${userId}/${code}/${port}/glados.yaml`;
}

/**
 * 到期时间 = 站点时间 + 剩余天数。
 * 优先用站点返回的 system_time（毫秒），避免本地时钟偏差影响展示。
 */
function resolveExpiresAt(status: Record<string, unknown>): number | null {
  const leftDays = finiteNumber(status.leftDays);
  if (leftDays == null) return null;
  const systemTimeMs = finiteNumber(status.system_time);
  const baseSeconds = systemTimeMs != null ? Math.floor(systemTimeMs / 1000) : unixNow();
  return baseSeconds + Math.round(leftDays * 86_400);
}

function resolvePlan(status: Record<string, unknown>): { level: string; limitGb: number } {
  const vip = finiteNumber(status.vip);
  if (vip == null) return DEFAULT_VIP_PLAN;
  return VIP_PLAN_MAP[Math.trunc(vip)] ?? DEFAULT_VIP_PLAN;
}

function snapshotFromStatus(status: Record<string, unknown>): GladosAccountSnapshot {
  const plan = resolvePlan(status);
  return {
    leftDays: statusLeftDays(status),
    subscriptionUrl: buildSubscriptionUrl(status),
    expiresAt: resolveExpiresAt(status),
    trafficLimitGb: plan.limitGb,
    planLevel: plan.level
  };
}

const EMPTY_SNAPSHOT: GladosAccountSnapshot = {
  leftDays: null,
  subscriptionUrl: null,
  expiresAt: null,
  trafficLimitGb: null,
  planLevel: null
};

/** 本月已用流量（字节）。站点前端读的就是 data.today，再除以 1 GiB 展示。 */
async function fetchTrafficUsedBytes(cookie: string, proxyUrl: string): Promise<number | null> {
  const payload = await gladosRequest('/api/user/traffic', { cookie, proxyUrl });
  return nonNegativeInt(asRecord(payload.data).today);
}

async function fetchPoints(cookie: string, proxyUrl: string): Promise<number | null> {
  const payload = await gladosRequest('/api/user/points', { cookie, proxyUrl });
  return nonNegativeInt(payload.points);
}

interface ExchangeResponse {
  ok: boolean;
  message: string;
}

async function exchange(cookie: string, plan: GladosExchangePlan, proxyUrl: string): Promise<ExchangeResponse> {
  const payload = await gladosRequest('/api/user/exchange', {
    method: 'POST',
    fields: { planType: plan },
    cookie,
    proxyUrl
  });
  const code = finiteNumber(payload.code);
  const message = responseError(payload, '兑换失败');
  return { ok: code === 0, message };
}

interface CheckinResponse {
  code: number;
  message: string;
  points: number | null;
}

async function checkin(cookie: string, proxyUrl: string): Promise<CheckinResponse> {
  const payload = await gladosRequest('/api/user/checkin', {
    method: 'POST',
    fields: { token: 'glados.cloud' },
    cookie,
    proxyUrl
  });
  const code = finiteNumber(payload.code);
  if (code == null) throw new Error(responseError(payload, '签到响应缺少 code'));
  return { code, message: responseError(payload, ''), points: finiteNumber(payload.points) };
}

async function insertLog(db: D1Database, input: {
  accountId: number;
  triggeredBy: GladosCheckinTriggeredBy;
  status: GladosCheckinLogStatus;
  reward?: number | null;
  rewardNote?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await dbRun(db, `
    INSERT INTO glados_checkin_logs (account_id, triggered_by, status, reward, reward_note, error_message, executed_at)
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
  leftDays?: number | null;
  trafficUsedBytes?: number | null;
  snapshot?: GladosAccountSnapshot;
  lastStatus: GladosCheckinStatus | null;
  lastMessage: string | null;
  status: GladosCheckinAccountStatus;
  lastError: string | null;
}): Promise<unknown> {
  const snapshot = input.snapshot ?? EMPTY_SNAPSHOT;
  return dbRun(db, `
    UPDATE glados_checkin_accounts
    SET points = COALESCE(?, points), left_days = COALESCE(?, left_days),
        balance_updated_at = CASE WHEN ? IS NOT NULL THEN ? ELSE balance_updated_at END,
        subscription_url = COALESCE(?, subscription_url),
        expires_at = COALESCE(?, expires_at),
        traffic_used_bytes = COALESCE(?, traffic_used_bytes),
        traffic_limit_gb = COALESCE(?, traffic_limit_gb),
        plan_level = COALESCE(?, plan_level),
        last_status = ?, last_message = ?, last_run_at = ?, status = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `, [
    input.points ?? null,
    input.leftDays ?? null,
    input.points ?? null,
    unixNow(),
    snapshot.subscriptionUrl,
    snapshot.expiresAt,
    input.trafficUsedBytes ?? null,
    snapshot.trafficLimitGb,
    snapshot.planLevel,
    input.lastStatus,
    input.lastMessage,
    unixNow(),
    input.status,
    input.lastError,
    unixNow(),
    accountId
  ]);
}

export interface GladosCheckinRunResult {
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

/**
 * 对单个 GLaDOS 账号执行完整签到流程：查询余额 -> 签到 -> 查询积分 -> 按需兑换积分。
 * 返回与公益站汇总通知兼容的形状（PublicCheckinNotificationItem 子集）。
 */
export async function runGladosCheckinForAccount(
  db: D1Database,
  accountId: number,
  triggeredBy: GladosCheckinTriggeredBy
): Promise<GladosCheckinRunResult> {
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM glados_checkin_accounts WHERE id = ?', [accountId]);
  if (!row) return { accountId, label: '-', siteName: 'GLaDOS', result: { success: false, status: 'failed', errorMessage: '账号不存在' } };
  if (row.status === 'disabled' || row.checkin_enabled !== 1) {
    const errorMessage = row.status === 'disabled' ? '账号已禁用' : '账号未启用自动签到';
    await insertLog(db, { accountId, triggeredBy, status: 'skipped', errorMessage });
    return { accountId, label: row.label, siteName: 'GLaDOS', result: { success: true, status: 'skipped', errorMessage: '账号已跳过' } };
  }

  const cookie = decryptPublicCheckinSecret(row.cookie_data);
  const proxyUrl = await resolveProxyUrl(db, Number(row.use_proxy) === 1);
  let earned: number | null = null;
  let pointsBefore: number | null = null;
  let points: number | null = null;
  let leftDays: number | null = null;
  let trafficUsedBytes: number | null = null;
  let snapshot: GladosAccountSnapshot = EMPTY_SNAPSHOT;
  const notes: string[] = [];

  try {
    let status: Record<string, unknown> | null = null;
    try {
      status = await fetchStatus(cookie, proxyUrl);
      snapshot = snapshotFromStatus(status);
      leftDays = snapshot.leftDays;
    } catch {
      // 余额查询失败不阻断签到，仅记录说明。
    }

    try {
      trafficUsedBytes = await fetchTrafficUsedBytes(cookie, proxyUrl);
    } catch {
      // 流量查询失败不阻断签到，保留库中旧值。
    }

    try {
      pointsBefore = await fetchPoints(cookie, proxyUrl);
    } catch {
      // 签到前积分查询失败时回退到库中上次记录，仍能估算增量。
    }
    if (pointsBefore == null) pointsBefore = row.points == null ? null : Number(row.points);

    const checkinResult = await checkin(cookie, proxyUrl);

    let pointsError: string | null = null;
    try {
      points = await fetchPoints(cookie, proxyUrl);
    } catch (error) {
      pointsError = error instanceof Error ? error.message : '未知错误';
    }
    earned = pointsBefore != null && points != null ? points - pointsBefore : null;

    let checkinStatus: GladosCheckinStatus;
    let summaryStatus: 'success' | 'failed';
    let errorMessage: string | null = null;
    let reward: number | null = null;

    if (checkinResult.code === 0) {
      checkinStatus = 'success';
      summaryStatus = 'success';
      reward = earned != null && earned > 0 ? earned : null;
      notes.push(reward == null ? '签到成功' : `签到成功，获得 ${reward} 积分`);
      // 站点回包的 points 语义未确认，先只做日志交叉校验，不进入 UI。
      console.info(
        `[GladosCheckin] 积分校验 accountId=${accountId} before=${pointsBefore ?? '-'} after=${points ?? '-'} delta=${earned ?? '-'} 回包points=${checkinResult.points ?? '-'}`
      );
    } else if (checkinResult.code === 1) {
      checkinStatus = 'repeat';
      summaryStatus = 'success';
      notes.push('今日已签到（重复）');
    } else {
      checkinStatus = 'failed';
      summaryStatus = 'failed';
      errorMessage = checkinResult.message || '签到失败';
      notes.push(`签到失败：${errorMessage}`);
    }

    if (pointsError) notes.push(`积分查询失败：${pointsError}`);

    if (points != null && row.exchange_enabled === 1 && row.exchange_plan) {
      const threshold = EXCHANGE_PLAN_POINTS[row.exchange_plan];
      if (points >= threshold) {
        try {
          const exchangeResult = await exchange(cookie, row.exchange_plan, proxyUrl);
          if (exchangeResult.ok) {
            notes.push(`兑换成功（${row.exchange_plan}）：${BASE_GLADOS_POINTS[row.exchange_plan]}`);
          } else {
            notes.push(`兑换失败：${exchangeResult.message}`);
          }
        } catch (error) {
          notes.push(`兑换出错：${error instanceof Error ? error.message : '未知错误'}`);
        }
      } else {
        notes.push(`积分不足，未兑换（${points}/${threshold}）`);
      }
    }

    const accountStatus: GladosCheckinAccountStatus = summaryStatus === 'failed' ? 'error' : 'active';
    await upsertAccountAfterRun(db, accountId, {
      points,
      leftDays,
      trafficUsedBytes,
      snapshot,
      lastStatus: checkinStatus,
      lastMessage: notes.join('；'),
      status: accountStatus,
      lastError: errorMessage
    });
    await insertLog(db, {
      accountId,
      triggeredBy,
      status: summaryStatus,
      reward,
      rewardNote: notes.join('；') || null,
      errorMessage
    });

    return {
      accountId,
      label: row.label,
      siteName: 'GLaDOS',
      result: {
        success: summaryStatus === 'success',
        status: summaryStatus,
        reward: reward ?? null,
        rewardNote: notes.join('；') || null,
        errorMessage,
        balanceBefore: pointsBefore,
        balanceAfter: points
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '签到失败';
    await upsertAccountAfterRun(db, accountId, {
      points,
      leftDays,
      trafficUsedBytes,
      snapshot,
      lastStatus: 'failed',
      lastMessage: message,
      status: 'error',
      lastError: message
    });
    await insertLog(db, { accountId, triggeredBy, status: 'failed', errorMessage: message });
    return { accountId, label: row.label, siteName: 'GLaDOS', result: { success: false, status: 'failed', errorMessage: message } };
  }
}

export async function runGladosCheckinAll(
  db: D1Database,
  triggeredBy: GladosCheckinTriggeredBy
): Promise<GladosCheckinRunResult[]> {
  const accounts = await dbAll<AccountRow>(
    db,
    "SELECT * FROM glados_checkin_accounts WHERE checkin_enabled = 1 AND status <> 'disabled' ORDER BY id ASC"
  );
  const results: GladosCheckinRunResult[] = [];
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    results.push(await runGladosCheckinForAccount(db, Number(account.id), triggeredBy));
    if (index < accounts.length - 1) await sleep(betweenAccountsDelayMs);
  }
  return results;
}

export async function testGladosConnection(db: D1Database, accountId: number): Promise<GladosTestResult> {
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM glados_checkin_accounts WHERE id = ?', [accountId]);
  if (!row) throw new HTTPException(404, { message: 'GLaDOS 账号不存在' });
  const cookie = decryptPublicCheckinSecret(row.cookie_data);
  const proxyUrl = await resolveProxyUrl(db, Number(row.use_proxy) === 1);
  try {
    const status = await fetchStatus(cookie, proxyUrl);
    const snapshot = snapshotFromStatus(status);
    const email = asString(status.email).trim() || undefined;
    let points: number | null = null;
    try {
      points = await fetchPoints(cookie, proxyUrl);
    } catch {
      // 积分查询失败不影响连接检测结果。
    }
    let trafficUsedBytes: number | null = null;
    try {
      trafficUsedBytes = await fetchTrafficUsedBytes(cookie, proxyUrl);
    } catch {
      // 流量查询失败不影响连接检测结果。
    }
    // 检测成功时同步落库，让列表无需再点一次「余额」就能看到订阅链接与流量。
    await dbRun(db, `
      UPDATE glados_checkin_accounts
      SET subscription_url = COALESCE(?, subscription_url),
          expires_at = COALESCE(?, expires_at),
          traffic_used_bytes = COALESCE(?, traffic_used_bytes),
          traffic_limit_gb = COALESCE(?, traffic_limit_gb),
          plan_level = COALESCE(?, plan_level),
          left_days = COALESCE(?, left_days),
          points = COALESCE(?, points),
          balance_updated_at = CASE WHEN ? IS NOT NULL THEN ? ELSE balance_updated_at END,
          status = 'active', last_error = NULL, updated_at = ?
      WHERE id = ?
    `, [
      snapshot.subscriptionUrl,
      snapshot.expiresAt,
      trafficUsedBytes,
      snapshot.trafficLimitGb,
      snapshot.planLevel,
      snapshot.leftDays,
      points,
      points,
      unixNow(),
      unixNow(),
      accountId
    ]);
    return {
      success: true,
      message: '连接正常',
      email,
      leftDays: snapshot.leftDays,
      points,
      subscriptionUrl: snapshot.subscriptionUrl,
      expiresAt: snapshot.expiresAt,
      trafficUsedBytes,
      trafficLimitGb: snapshot.trafficLimitGb,
      planLevel: snapshot.planLevel
    };
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
 * 与 `/api/public-checkin/checkin/logs` 保持同一套查询参数与响应形状（含 accountLabel/siteName），
 * 前端「签到日志」弹框因此可以直接复用同一份表格列定义与筛选控件。
 */
async function listLogs(db: D1Database, queryInput: URLSearchParams): Promise<GladosCheckinLogResponse> {
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
    FROM glados_checkin_logs l
    INNER JOIN glados_checkin_accounts a ON a.id = l.account_id
    ${where}
    ORDER BY l.executed_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `, [...values, limit, offset]);
  const totalRow = await dbFirst<{ count: number }>(db, `
    SELECT COUNT(*) AS count
    FROM glados_checkin_logs l
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
      siteName: 'GLaDOS'
    })),
    total: Number(totalRow?.count || 0),
    limit,
    offset
  };
}

export function registerGladosCheckinRoutes(app: Hono<any>): void {
  app.get('/api/public-checkin/glados/accounts', async (c) => c.json(await listAccounts(c.env.DB)));
  app.post('/api/public-checkin/glados/accounts', async (c) => c.json(await createAccount(c.env.DB, await readBody(c)), 201));
  app.put('/api/public-checkin/glados/accounts/:id', async (c) => c.json(await updateAccount(c.env.DB, routeId(c.req.param('id')), await readBody(c))));
  app.delete('/api/public-checkin/glados/accounts/:id', async (c) => {
    await deleteAccount(c.env.DB, routeId(c.req.param('id')));
    return c.body(null, 204);
  });
  app.get('/api/public-checkin/glados/accounts/:id/credential', async (c) => {
    const row = await dbFirst<AccountRow>(c.env.DB, 'SELECT * FROM glados_checkin_accounts WHERE id = ?', [routeId(c.req.param('id'))]);
    if (!row) throw new HTTPException(404, { message: 'GLaDOS 账号不存在' });
    return c.json({ cookie: decryptPublicCheckinSecret(row.cookie_data) });
  });
  app.post('/api/public-checkin/glados/accounts/:id/test', async (c) => c.json(await testGladosConnection(c.env.DB, routeId(c.req.param('id')))));
  app.post('/api/public-checkin/glados/accounts/:id/checkin', async (c) => c.json(await runGladosCheckinForAccount(c.env.DB, routeId(c.req.param('id')), 'manual')));
  app.post('/api/public-checkin/glados/accounts/:id/refresh-balance', async (c) => {
    const accountId = routeId(c.req.param('id'));
    const result = await testGladosConnection(c.env.DB, accountId);
    if (result.success) {
      await dbRun(c.env.DB, `
        UPDATE glados_checkin_accounts
        SET points = ?, left_days = ?, balance_updated_at = ?,
            subscription_url = COALESCE(?, subscription_url),
            expires_at = COALESCE(?, expires_at),
            traffic_used_bytes = COALESCE(?, traffic_used_bytes),
            traffic_limit_gb = COALESCE(?, traffic_limit_gb),
            plan_level = COALESCE(?, plan_level),
            status = 'active', last_error = NULL, updated_at = ?
        WHERE id = ?
      `, [
        result.points ?? null,
        result.leftDays ?? null,
        unixNow(),
        result.subscriptionUrl ?? null,
        result.expiresAt ?? null,
        result.trafficUsedBytes ?? null,
        result.trafficLimitGb ?? null,
        result.planLevel ?? null,
        unixNow(),
        accountId
      ]);
    }
    return c.json(result);
  });
  app.get('/api/public-checkin/glados/logs', async (c) => c.json(await listLogs(c.env.DB, new URL(c.req.url).searchParams)));
}

export const gladosCheckinTestHooks = {
  setFetch(fetchImpl: typeof undiciFetch | null): void {
    requestFetch = fetchImpl || undiciFetch;
  },
  setTiming(input: { betweenAccountsDelayMs?: number }): void {
    if (input.betweenAccountsDelayMs != null) betweenAccountsDelayMs = input.betweenAccountsDelayMs;
  },
  reset(): void {
    requestFetch = undiciFetch;
    betweenAccountsDelayMs = 1_000;
  }
};