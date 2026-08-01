import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  fetch as undiciFetch,
  FormData as UndiciFormData,
  type RequestInit as UndiciRequestInit
} from 'undici';

import {
  decryptPublicCheckinSecret,
  encryptPublicCheckinSecret
} from './public-checkin.ts';

export type PokemonRenewalAccountStatus = 'success' | 'skipped' | 'failed';
export type PokemonRenewalRunStatus = 'running' | 'completed' | 'failed' | 'interrupted';
export type PokemonRenewalLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface PokemonRenewalAccount {
  id: number;
  email: string;
  enabled: boolean;
  expiredAt: number | null;
  lastStatus: PokemonRenewalAccountStatus | null;
  lastMessage: string | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PokemonRenewalLogEntry {
  at: number;
  level: PokemonRenewalLogLevel;
  accountId: number | null;
  accountEmail: string | null;
  stage: string;
  message: string;
}

export interface PokemonRenewalResult {
  id: number;
  runId: string;
  accountId: number | null;
  accountEmail: string;
  status: PokemonRenewalAccountStatus;
  reasonCode: string;
  message: string;
  expiredAtBefore: number | null;
  expiredAtAfter: number | null;
  tradeNo: string | null;
  startedAt: number;
  finishedAt: number;
}

export interface PokemonRenewalRunSnapshot {
  id: string;
  status: PokemonRenewalRunStatus;
  totalCount: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  currentAccountId: number | null;
  progress: number;
  message: string;
  logs: PokemonRenewalLogEntry[];
  errorMessage: string | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  results: PokemonRenewalResult[];
}

type AccountRow = {
  id: number;
  email: string;
  password_data: string;
  enabled: number;
  expired_at: number | null;
  last_status: PokemonRenewalAccountStatus | null;
  last_message: string | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
};

type RunRow = {
  id: string;
  status: PokemonRenewalRunStatus;
  total_count: number;
  success_count: number;
  skipped_count: number;
  failed_count: number;
  current_account_id: number | null;
  progress: number;
  message: string;
  logs_json: string;
  error_message: string | null;
  started_at: number;
  updated_at: number;
  finished_at: number | null;
};

type ResultRow = {
  id: number;
  run_id: string;
  account_id: number | null;
  account_email: string;
  status: PokemonRenewalAccountStatus;
  reason_code: string;
  message: string;
  expired_at_before: number | null;
  expired_at_after: number | null;
  trade_no: string | null;
  started_at: number;
  finished_at: number;
};

type RuntimeJob = {
  id: string;
  logs: PokemonRenewalLogEntry[];
};

type AccountExecution = Omit<PokemonRenewalResult, 'id' | 'runId' | 'accountId' | 'accountEmail'>;

const POKEMON_CONFIG_KEY = 'pokemon_renewal_config';
const POKEMON_API_BASE = 'https://api123.136470.xyz/api/v1';
const POKEMON_PLAN_ID = 8;
const POKEMON_PERIOD = 'month_price';
const MAX_JOB_LOGS = 300;
const RESPONSE_SOURCE_BASE64 = 'bnN6e2dBV3JrWGx4MDhKNkVxOlY0W2RlTzFEUVRDd20yb0IzdHk5alNZSV03Uk01YkhpVWFmLGN9S3VQR3BOaFpMdkY=';
const RESPONSE_TARGET_BASE64 = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0NTY3ODksW117fTo=';

const runtimeJobs = new Map<string, RuntimeJob>();
let requestFetch: typeof undiciFetch = undiciFetch;
let pollIntervalMs = 3_000;
let pollTimeoutMs = 90_000;
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

function integerMoney(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed == null || parsed < 0 ? null : Math.round(parsed);
}

function clampPercent(value: unknown): number {
  const parsed = finiteNumber(value);
  if (parsed == null) return 0;
  const integer = Math.trunc(parsed);
  return integer < 0 || integer > 100 ? 0 : integer;
}

function accountFromRow(row: AccountRow): PokemonRenewalAccount {
  return {
    id: Number(row.id),
    email: row.email,
    enabled: Number(row.enabled) === 1,
    expiredAt: row.expired_at == null ? null : Number(row.expired_at),
    lastStatus: row.last_status,
    lastMessage: row.last_message,
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function resultFromRow(row: ResultRow): PokemonRenewalResult {
  return {
    id: Number(row.id),
    runId: row.run_id,
    accountId: row.account_id == null ? null : Number(row.account_id),
    accountEmail: row.account_email,
    status: row.status,
    reasonCode: row.reason_code,
    message: row.message,
    expiredAtBefore: row.expired_at_before == null ? null : Number(row.expired_at_before),
    expiredAtAfter: row.expired_at_after == null ? null : Number(row.expired_at_after),
    tradeNo: row.trade_no,
    startedAt: Number(row.started_at),
    finishedAt: Number(row.finished_at)
  };
}

function parseLogs(value: string): PokemonRenewalLogEntry[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.slice(-MAX_JOB_LOGS) as PokemonRenewalLogEntry[] : [];
  } catch {
    return [];
  }
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

async function setAppSetting(db: D1Database, key: string, value: string): Promise<void> {
  await dbRun(db, `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `, [key, value]);
}

function validateEmail(value: unknown): string {
  const email = asString(value).trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HTTPException(400, { message: '请输入有效的宝可梦账号邮箱' });
  }
  return email;
}

function validatePassword(value: unknown, required: boolean): string {
  const password = asString(value);
  if (!password && !required) return '';
  if (!password || password.length > 512) {
    throw new HTTPException(400, { message: '密码不能为空且不能超过 512 个字符' });
  }
  return password;
}

function validateCoupon(value: unknown): string {
  const couponCode = asString(value).trim();
  if (!couponCode || couponCode.length > 200) {
    throw new HTTPException(400, { message: '优惠码不能为空且不能超过 200 个字符' });
  }
  return couponCode;
}

async function assertNoActiveRun(db: D1Database): Promise<void> {
  const active = Array.from(runtimeJobs.keys())[0];
  if (active) {
    throw new HTTPException(409, { message: '宝可梦续费任务正在运行，请等待完成' });
  }
  const staleRows = await dbAll<{ id: string }>(db, "SELECT id FROM pokemon_renewal_runs WHERE status = 'running'");
  for (const row of staleRows) {
    await dbRun(db, `
      UPDATE pokemon_renewal_runs
      SET status = 'interrupted', message = '服务重启，任务已中断', error_message = '服务重启，任务已中断',
          updated_at = ?, finished_at = ?
      WHERE id = ? AND status = 'running'
    `, [unixNow(), unixNow(), row.id]);
  }
}

async function listAccounts(db: D1Database): Promise<PokemonRenewalAccount[]> {
  const rows = await dbAll<AccountRow>(db, 'SELECT * FROM pokemon_renewal_accounts ORDER BY id ASC');
  return rows.map(accountFromRow);
}

async function createAccount(db: D1Database, input: unknown): Promise<PokemonRenewalAccount> {
  await assertNoActiveRun(db);
  const body = asRecord(input);
  const email = validateEmail(body.email);
  const password = validatePassword(body.password, true);
  const enabled = body.enabled !== false;
  try {
    const result = await dbRun(db, `
      INSERT INTO pokemon_renewal_accounts (email, password_data, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `, [email, encryptPublicCheckinSecret(password), enabled ? 1 : 0, unixNow(), unixNow()]);
    const row = await dbFirst<AccountRow>(db, 'SELECT * FROM pokemon_renewal_accounts WHERE id = ?', [Number(result.meta.last_row_id)]);
    if (!row) throw new Error('账号保存后读取失败');
    return accountFromRow(row);
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : String(error))) {
      throw new HTTPException(409, { message: '该宝可梦账号已存在' });
    }
    throw error;
  }
}

async function updateAccount(db: D1Database, id: number, input: unknown): Promise<PokemonRenewalAccount> {
  await assertNoActiveRun(db);
  const current = await dbFirst<AccountRow>(db, 'SELECT * FROM pokemon_renewal_accounts WHERE id = ?', [id]);
  if (!current) throw new HTTPException(404, { message: '宝可梦账号不存在' });
  const body = asRecord(input);
  const email = body.email == null ? current.email : validateEmail(body.email);
  const password = validatePassword(body.password, false);
  const enabled = body.enabled == null ? Number(current.enabled) === 1 : body.enabled !== false;
  try {
    await dbRun(db, `
      UPDATE pokemon_renewal_accounts
      SET email = ?, password_data = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `, [
      email,
      password ? encryptPublicCheckinSecret(password) : current.password_data,
      enabled ? 1 : 0,
      unixNow(),
      id
    ]);
  } catch (error) {
    if (/unique/i.test(error instanceof Error ? error.message : String(error))) {
      throw new HTTPException(409, { message: '该宝可梦账号已存在' });
    }
    throw error;
  }
  const row = await dbFirst<AccountRow>(db, 'SELECT * FROM pokemon_renewal_accounts WHERE id = ?', [id]);
  if (!row) throw new Error('账号更新后读取失败');
  return accountFromRow(row);
}

async function deleteAccount(db: D1Database, id: number): Promise<void> {
  await assertNoActiveRun(db);
  const result = await dbRun(db, 'DELETE FROM pokemon_renewal_accounts WHERE id = ?', [id]);
  if (!result.meta.changes) throw new HTTPException(404, { message: '宝可梦账号不存在' });
}

async function getConfig(db: D1Database): Promise<{ couponCode: string; configured: boolean }> {
  const stored = await getAppSetting(db, POKEMON_CONFIG_KEY);
  if (!stored) return { couponCode: '', configured: false };
  try {
    const parsed = asRecord(JSON.parse(stored));
    const encrypted = asString(parsed.couponCodeEncrypted);
    const couponCode = encrypted ? decryptPublicCheckinSecret(encrypted) : '';
    return { couponCode, configured: Boolean(couponCode) };
  } catch {
    return { couponCode: '', configured: false };
  }
}

async function updateConfig(db: D1Database, input: unknown): Promise<{ couponCode: string; configured: boolean }> {
  await assertNoActiveRun(db);
  const couponCode = validateCoupon(asRecord(input).couponCode);
  await setAppSetting(db, POKEMON_CONFIG_KEY, JSON.stringify({
    couponCodeEncrypted: encryptPublicCheckinSecret(couponCode)
  }));
  return { couponCode, configured: true };
}

export function decodePokemonResponse(payload: string): Record<string, unknown> {
  let encoded = payload.trim();
  if (encoded.startsWith('"')) {
    try {
      encoded = JSON.parse(encoded) as string;
    } catch {
      // Keep the original text so the error below remains readable.
    }
  }
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw new Error('站点响应解码失败');
  }
  const source = Buffer.from(RESPONSE_SOURCE_BASE64, 'base64').toString('utf8');
  const target = Buffer.from(RESPONSE_TARGET_BASE64, 'base64').toString('utf8');
  for (let round = 0; round < 10; round += 1) {
    decoded = Array.from(decoded, (character) => {
      const index = source.indexOf(character);
      return index >= 0 ? target[index] : character;
    }).join('');
  }
  try {
    return asRecord(JSON.parse(decoded));
  } catch {
    throw new Error('站点响应格式无效');
  }
}

function pokemonResponseError(payload: Record<string, unknown>, fallback: string): string {
  const errors = asRecord(payload.errors);
  for (const value of Object.values(errors)) {
    if (Array.isArray(value)) {
      const message = value.map((item) => asString(item).trim()).find(Boolean);
      if (message) return message;
    }
    const message = asString(value).trim();
    if (message) return message;
  }
  return asString(payload.message).trim() || fallback;
}

async function pokemonRequest(
  pathname: string,
  options: { method?: 'GET' | 'POST'; fields?: Record<string, string | number>; authToken?: string } = {}
): Promise<Record<string, unknown>> {
  const url = new URL(`${POKEMON_API_BASE}${pathname}`);
  const headers: Record<string, string> = { 'theme-ua': 'mala-pro' };
  if (options.authToken) headers.Authorization = options.authToken;
  let body: UndiciFormData | undefined;
  if (options.method === 'POST') {
    body = new UndiciFormData();
    for (const [key, value] of Object.entries(options.fields || {})) body.append(key, String(value));
  } else {
    for (const [key, value] of Object.entries(options.fields || {})) url.searchParams.set(key, String(value));
  }
  let response: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    response = await requestFetch(url, {
      method: options.method || 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(15_000)
    } as UndiciRequestInit);
  } catch (error) {
    throw new Error(`站点请求失败：${error instanceof Error ? error.message : '网络异常'}`);
  }
  if (response.status === 403) throw new Error('账号登录已失效或站点拒绝访问');
  const payload = decodePokemonResponse(await response.text());
  if (!response.ok) {
    throw new Error(pokemonResponseError(payload, `站点返回 HTTP ${response.status}`));
  }
  return payload;
}

async function login(email: string, password: string): Promise<string> {
  const payload = await pokemonRequest('/passport/auth/login', {
    method: 'POST',
    fields: { email, password }
  });
  const token = asString(asRecord(payload.data).auth_data).trim();
  if (!token) throw new Error(asString(payload.message) || '登录失败，站点未返回登录凭证');
  return token;
}

async function userInfo(token: string): Promise<Record<string, unknown>> {
  const payload = await pokemonRequest('/user/info', { authToken: token });
  const data = asRecord(payload.data);
  if (!Object.keys(data).length) throw new Error(asString(payload.message) || '用户信息缺失');
  return data;
}

function expiryFromUserInfo(info: Record<string, unknown>): number {
  const expiredAt = finiteNumber(info.expired_at);
  if (expiredAt == null || expiredAt < 0) throw new Error('用户信息缺少有效到期时间');
  return Math.trunc(expiredAt);
}

export function calculatePokemonDiscountedPrice(
  planPrice: unknown,
  userDiscount: unknown,
  couponInput: unknown
): number {
  const original = integerMoney(planPrice);
  if (original == null) throw new Error('套餐月付价格无效');
  const exclusiveDiscount = clampPercent(userDiscount);
  let price = Math.max(0, Math.round(original * (100 - exclusiveDiscount) / 100));
  const coupon = asRecord(couponInput);
  const couponType = finiteNumber(coupon.type);
  const couponValue = finiteNumber(coupon.value);
  if (couponType == null || couponValue == null || couponValue < 0) throw new Error('优惠码返回的折扣字段无效');
  if (couponType === 1) price -= couponValue;
  else if (couponType === 2) price *= 1 - couponValue / 100;
  else throw new Error('优惠码类型不受支持');
  return Math.max(0, Math.round(price));
}

function includesValue(input: unknown, expected: string): boolean {
  if (!Array.isArray(input) || input.length === 0) return true;
  return input.map((item) => String(item)).includes(expected);
}

function couponAlreadyUsed(message: string): boolean {
  return /每人只能(?:使用|用)?\s*1\s*次/.test(message);
}

async function appendLog(
  db: D1Database,
  job: RuntimeJob,
  input: Omit<PokemonRenewalLogEntry, 'at'>
): Promise<void> {
  job.logs.push({ at: unixNow(), ...input });
  if (job.logs.length > MAX_JOB_LOGS) job.logs.splice(0, job.logs.length - MAX_JOB_LOGS);
  await dbRun(db, 'UPDATE pokemon_renewal_runs SET logs_json = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(job.logs), unixNow(), job.id
  ]);
}

async function executeAccount(
  db: D1Database,
  job: RuntimeJob,
  account: AccountRow,
  couponCode: string
): Promise<AccountExecution> {
  const startedAt = unixNow();
  let expiredAtBefore: number | null = null;
  let expiredAtAfter: number | null = null;
  let tradeNo: string | null = null;
  const log = (level: PokemonRenewalLogLevel, stage: string, message: string) => appendLog(db, job, {
    level,
    accountId: Number(account.id),
    accountEmail: account.email,
    stage,
    message
  });
  const outcome = (
    status: PokemonRenewalAccountStatus,
    reasonCode: string,
    message: string
  ): AccountExecution => ({
    status,
    reasonCode,
    message,
    expiredAtBefore,
    expiredAtAfter,
    tradeNo,
    startedAt,
    finishedAt: unixNow()
  });

  try {
    await log('info', 'login', '正在登录账号');
    const password = decryptPublicCheckinSecret(account.password_data);
    const token = await login(account.email, password);
    await log('success', 'login', '登录成功');

    const beforeInfo = await userInfo(token);
    expiredAtBefore = expiryFromUserInfo(beforeInfo);
    await log('info', 'profile', `当前到期时间：${formatExpiry(expiredAtBefore)}`);

    const ordersPayload = await pokemonRequest('/user/order/fetch', { authToken: token });
    const orders = Array.isArray(ordersPayload.data) ? ordersPayload.data : [];
    const pendingOrder = orders.map(asRecord).find((item) => finiteNumber(item.status) === 0);
    if (pendingOrder) {
      await log('warning', 'order', '检测到待支付订单，已跳过且不会自动取消');
      return outcome('skipped', 'pending_order', '存在待支付订单，请先人工处理');
    }

    const planPayload = await pokemonRequest('/user/plan/fetch', {
      authToken: token,
      fields: { id: POKEMON_PLAN_ID }
    });
    const plan = asRecord(planPayload.data);
    if (!Object.keys(plan).length) throw new Error('套餐信息缺失');

    await log('info', 'coupon', '正在校验优惠码');
    let couponPayload: Record<string, unknown>;
    try {
      couponPayload = await pokemonRequest('/user/coupon/check', {
        method: 'POST',
        authToken: token,
        fields: { code: couponCode, plan_id: POKEMON_PLAN_ID }
      });
    } catch (error) {
      const couponError = error instanceof Error ? error.message : '优惠码验证失败';
      if (couponAlreadyUsed(couponError)) {
        await log('warning', 'coupon', '该优惠券每人只能使用 1 次，已跳过账号');
        return outcome('skipped', 'coupon_already_used', couponError);
      }
      throw error;
    }
    const couponMessage = asString(couponPayload.message);
    if (!couponPayload.data) {
      if (couponAlreadyUsed(couponMessage)) {
        await log('warning', 'coupon', '该优惠券每人只能使用 1 次，已跳过账号');
        return outcome('skipped', 'coupon_already_used', couponMessage || '该优惠券每人只能使用 1 次');
      }
      throw new Error(couponMessage || '优惠码验证失败');
    }
    const coupon = asRecord(couponPayload.data);
    if (!includesValue(coupon.limit_plan_ids, String(POKEMON_PLAN_ID))) throw new Error('优惠码不适用于入门精灵球套餐');
    if (!includesValue(coupon.limit_period, POKEMON_PERIOD)) throw new Error('优惠码不适用于月付周期');
    const discountedPrice = calculatePokemonDiscountedPrice(plan.month_price, beforeInfo.discount, coupon);
    if (discountedPrice !== 0) throw new Error(`优惠后月付金额为 ¥${(discountedPrice / 100).toFixed(2)}，已停止创建订单`);
    await log('success', 'coupon', '优惠码有效，月付金额已确认 ¥0.00');

    const savePayload = await pokemonRequest('/user/order/save', {
      method: 'POST',
      authToken: token,
      fields: { plan_id: POKEMON_PLAN_ID, period: POKEMON_PERIOD, coupon_code: couponCode }
    });
    tradeNo = asString(savePayload.data).trim();
    if (!tradeNo) throw new Error(asString(savePayload.message) || '订单创建后未返回订单号');
    await log('success', 'order', '零元订单已创建');

    const detailPayload = await pokemonRequest('/user/order/detail', {
      authToken: token,
      fields: { trade_no: tradeNo }
    });
    const detail = asRecord(detailPayload.data);
    const totalAmount = integerMoney(detail.total_amount);
    if (totalAmount !== 0) throw new Error('订单详情金额不是 ¥0.00，已停止结算');

    if (finiteNumber(detail.status) !== 3) {
      await log('info', 'checkout', '正在完成零元订单');
      const checkoutPayload = await pokemonRequest('/user/order/checkout', {
        method: 'POST',
        authToken: token,
        fields: { trade_no: tradeNo, method: 1 }
      });
      if (!checkoutPayload.data) throw new Error(asString(checkoutPayload.message) || '零元订单处理失败');
    }

    await log('info', 'confirm', '正在等待订单完成并刷新到期时间');
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() <= deadline) {
      const checkPayload = await pokemonRequest('/user/order/check', {
        authToken: token,
        fields: { trade_no: tradeNo }
      });
      if (finiteNumber(checkPayload.data) === 3) {
        const afterInfo = await userInfo(token);
        expiredAtAfter = expiryFromUserInfo(afterInfo);
        if (expiredAtAfter > expiredAtBefore) {
          await log('success', 'complete', `续费成功，新到期时间：${formatExpiry(expiredAtAfter)}`);
          return outcome('success', 'renewed', '套餐续费成功');
        }
      }
      await sleep(pollIntervalMs);
    }
    throw new Error('等待订单完成或到期时间更新超时，请人工检查订单');
  } catch (error) {
    const message = error instanceof Error ? error.message : '续费失败';
    await log('error', 'failed', message);
    return outcome('failed', reasonCodeFromError(message), message);
  }
}

function reasonCodeFromError(message: string): string {
  if (/登录|凭证|未授权/.test(message)) return 'login_failed';
  if (/金额|价格/.test(message)) return 'non_zero_or_invalid_price';
  if (/优惠码|优惠券|周期|套餐/.test(message)) return 'coupon_invalid';
  if (/超时/.test(message)) return 'order_timeout';
  if (/订单/.test(message)) return 'order_failed';
  return 'request_failed';
}

function formatExpiry(value: number): string {
  return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

async function persistResult(db: D1Database, runId: string, account: AccountRow, result: AccountExecution): Promise<void> {
  await dbRun(db, `
    INSERT INTO pokemon_renewal_results (
      run_id, account_id, account_email, status, reason_code, message,
      expired_at_before, expired_at_after, trade_no, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    runId, Number(account.id), account.email, result.status, result.reasonCode, result.message,
    result.expiredAtBefore, result.expiredAtAfter, result.tradeNo, result.startedAt, result.finishedAt
  ]);
  await dbRun(db, `
    UPDATE pokemon_renewal_accounts
    SET expired_at = COALESCE(?, expired_at), last_status = ?, last_message = ?, last_run_at = ?, updated_at = ?
    WHERE id = ?
  `, [
    result.expiredAtAfter ?? result.expiredAtBefore,
    result.status,
    result.message,
    result.finishedAt,
    unixNow(),
    Number(account.id)
  ]);
}

async function runBatch(db: D1Database, job: RuntimeJob, accounts: AccountRow[], couponCode: string): Promise<void> {
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  try {
    await appendLog(db, job, {
      level: 'info', accountId: null, accountEmail: null, stage: 'start',
      message: `开始依次处理 ${accounts.length} 个启用账号`
    });
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      await dbRun(db, `
        UPDATE pokemon_renewal_runs
        SET current_account_id = ?, progress = ?, message = ?, updated_at = ?
        WHERE id = ?
      `, [Number(account.id), Math.floor(index / accounts.length * 100), `正在处理 ${account.email}`, unixNow(), job.id]);
      await appendLog(db, job, {
        level: 'info', accountId: Number(account.id), accountEmail: account.email, stage: 'account',
        message: `开始处理账号 ${index + 1}/${accounts.length}`
      });
      const result = await executeAccount(db, job, account, couponCode);
      await persistResult(db, job.id, account, result);
      if (result.status === 'success') successCount += 1;
      else if (result.status === 'skipped') skippedCount += 1;
      else failedCount += 1;
      await dbRun(db, `
        UPDATE pokemon_renewal_runs
        SET success_count = ?, skipped_count = ?, failed_count = ?, progress = ?, updated_at = ?
        WHERE id = ?
      `, [successCount, skippedCount, failedCount, Math.round((index + 1) / accounts.length * 100), unixNow(), job.id]);
      if (index < accounts.length - 1) await sleep(betweenAccountsDelayMs);
    }
    const message = `续费完成：成功 ${successCount}，跳过 ${skippedCount}，失败 ${failedCount}`;
    await appendLog(db, job, {
      level: failedCount > 0 ? 'warning' : 'success', accountId: null, accountEmail: null, stage: 'summary', message
    });
    await dbRun(db, `
      UPDATE pokemon_renewal_runs
      SET status = 'completed', current_account_id = NULL, progress = 100, message = ?,
          success_count = ?, skipped_count = ?, failed_count = ?, updated_at = ?, finished_at = ?
      WHERE id = ?
    `, [message, successCount, skippedCount, failedCount, unixNow(), unixNow(), job.id]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '续费任务异常终止';
    await appendLog(db, job, {
      level: 'error', accountId: null, accountEmail: null, stage: 'fatal', message
    }).catch(() => undefined);
    await dbRun(db, `
      UPDATE pokemon_renewal_runs
      SET status = 'failed', current_account_id = NULL, message = ?, error_message = ?, updated_at = ?, finished_at = ?
      WHERE id = ?
    `, [message, message, unixNow(), unixNow(), job.id]);
  } finally {
    runtimeJobs.delete(job.id);
  }
}

async function startRun(db: D1Database): Promise<PokemonRenewalRunSnapshot> {
  await assertNoActiveRun(db);
  const config = await getConfig(db);
  if (!config.configured) throw new HTTPException(400, { message: '请先保存本月优惠码' });
  const accounts = await dbAll<AccountRow>(db, 'SELECT * FROM pokemon_renewal_accounts WHERE enabled = 1 ORDER BY id ASC');
  if (!accounts.length) throw new HTTPException(400, { message: '请至少启用一个宝可梦账号' });
  const id = randomUUID();
  const now = unixNow();
  await dbRun(db, `
    INSERT INTO pokemon_renewal_runs (
      id, status, total_count, progress, message, logs_json, started_at, updated_at
    ) VALUES (?, 'running', ?, 0, '准备开始续费', '[]', ?, ?)
  `, [id, accounts.length, now, now]);
  const job: RuntimeJob = { id, logs: [] };
  runtimeJobs.set(id, job);
  void runBatch(db, job, accounts, config.couponCode);
  return getRun(db, id);
}

async function normalizeInterruptedRun(db: D1Database, row: RunRow): Promise<RunRow> {
  if (row.status !== 'running' || runtimeJobs.has(row.id)) return row;
  const now = unixNow();
  await dbRun(db, `
    UPDATE pokemon_renewal_runs
    SET status = 'interrupted', message = '服务重启，任务已中断', error_message = '服务重启，任务已中断',
        updated_at = ?, finished_at = ? WHERE id = ? AND status = 'running'
  `, [now, now, row.id]);
  return { ...row, status: 'interrupted', message: '服务重启，任务已中断', error_message: '服务重启，任务已中断', updated_at: now, finished_at: now };
}

async function snapshotFromRow(db: D1Database, input: RunRow): Promise<PokemonRenewalRunSnapshot> {
  const row = await normalizeInterruptedRun(db, input);
  const resultRows = await dbAll<ResultRow>(db, 'SELECT * FROM pokemon_renewal_results WHERE run_id = ? ORDER BY id ASC', [row.id]);
  return {
    id: row.id,
    status: row.status,
    totalCount: Number(row.total_count),
    successCount: Number(row.success_count),
    skippedCount: Number(row.skipped_count),
    failedCount: Number(row.failed_count),
    currentAccountId: row.current_account_id == null ? null : Number(row.current_account_id),
    progress: Number(row.progress),
    message: row.message,
    logs: parseLogs(row.logs_json),
    errorMessage: row.error_message,
    startedAt: Number(row.started_at),
    updatedAt: Number(row.updated_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    results: resultRows.map(resultFromRow)
  };
}

async function getRun(db: D1Database, id: string): Promise<PokemonRenewalRunSnapshot> {
  const row = await dbFirst<RunRow>(db, 'SELECT * FROM pokemon_renewal_runs WHERE id = ?', [id]);
  if (!row) throw new HTTPException(404, { message: '续费任务不存在' });
  return snapshotFromRow(db, row);
}

async function listRuns(db: D1Database, limit: number): Promise<PokemonRenewalRunSnapshot[]> {
  const rows = await dbAll<RunRow>(db, 'SELECT * FROM pokemon_renewal_runs ORDER BY started_at DESC LIMIT ?', [limit]);
  return Promise.all(rows.map((row) => snapshotFromRow(db, row)));
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

export function registerPokemonRenewalRoutes(app: Hono<any>): void {
  app.get('/api/public-checkin/pokemon/accounts', async (c) => c.json(await listAccounts(c.env.DB)));
  app.post('/api/public-checkin/pokemon/accounts', async (c) => c.json(await createAccount(c.env.DB, await readBody(c)), 201));
  app.put('/api/public-checkin/pokemon/accounts/:id', async (c) => c.json(await updateAccount(c.env.DB, routeId(c.req.param('id')), await readBody(c))));
  app.delete('/api/public-checkin/pokemon/accounts/:id', async (c) => {
    await deleteAccount(c.env.DB, routeId(c.req.param('id')));
    return c.body(null, 204);
  });
  app.get('/api/public-checkin/pokemon/config', async (c) => c.json(await getConfig(c.env.DB)));
  app.put('/api/public-checkin/pokemon/config', async (c) => c.json(await updateConfig(c.env.DB, await readBody(c))));
  app.get('/api/public-checkin/pokemon/renewal-runs', async (c) => {
    const parsed = Number(c.req.query('limit') || 10);
    const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.trunc(parsed))) : 10;
    return c.json(await listRuns(c.env.DB, limit));
  });
  app.post('/api/public-checkin/pokemon/renewal-runs', async (c) => c.json(await startRun(c.env.DB), 202));
  app.get('/api/public-checkin/pokemon/renewal-runs/:id', async (c) => c.json(await getRun(c.env.DB, c.req.param('id'))));
}

export const pokemonRenewalTestHooks = {
  setFetch(fetchImpl: typeof undiciFetch | null): void {
    requestFetch = fetchImpl || undiciFetch;
  },
  setTiming(input: { pollIntervalMs?: number; pollTimeoutMs?: number; betweenAccountsDelayMs?: number }): void {
    if (input.pollIntervalMs != null) pollIntervalMs = input.pollIntervalMs;
    if (input.pollTimeoutMs != null) pollTimeoutMs = input.pollTimeoutMs;
    if (input.betweenAccountsDelayMs != null) betweenAccountsDelayMs = input.betweenAccountsDelayMs;
  },
  reset(): void {
    requestFetch = undiciFetch;
    pollIntervalMs = 3_000;
    pollTimeoutMs = 90_000;
    betweenAccountsDelayMs = 1_000;
    runtimeJobs.clear();
  },
  calculateDiscountedPrice: calculatePokemonDiscountedPrice,
  decodeResponse: decodePokemonResponse
};
