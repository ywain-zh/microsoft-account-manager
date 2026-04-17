import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  INGEST_TOKEN?: string;
  MAIL_API_TOKEN?: string;
};

type Variables = {
  authUser: string;
};

type MailFetchMode = 'auto' | 'graph' | 'imap';
type ResolvedMailFetchMode = 'graph' | 'imap';
type TokenStatus = 'unknown' | 'valid' | 'invalid';

interface AccountRow {
  id: number;
  account: string;
  password: string;
  clientId: string | null;
  refreshToken: string | null;
  remark: string | null;
  createdAt: string;
  syncStatus: string;
  syncMessage: string | null;
  refreshedAt: string | null;
  fetchedAt: string | null;
  fetchedCount: number;
  tokenStatus: TokenStatus;
  tokenMessage: string | null;
  tokenCheckedAt: string | null;
}

interface AccountPayload {
  account: string;
  password: string;
  clientId?: string;
  refreshToken?: string;
  remark?: string;
}

interface IngestConfig {
  delimiter: string;
  captchaField: string;
  accountField: string;
  passwordField: string;
  clientIdField: string;
  tokenField: string;
}

interface CloudMailConfig {
  apiBaseUrl: string;
  adminEmail: string;
  adminPassword: string;
  availableDomains: string[];
}

interface CloudMailAccountItem {
  userId: number;
  email: string;
  status: number;
  receiveEmailCount: number;
  sendEmailCount: number;
  activeTime: string | null;
  createTime: string | null;
}

interface CloudMailListResponse {
  items: CloudMailAccountItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface CloudMailRemoteEnvelope<T> {
  code?: number | string;
  message?: string;
  data?: T;
}

interface SessionPayload {
  username: string;
  exp: number;
}

interface ParseErrorItem {
  line: number;
  raw: string;
  reason: string;
}

interface ParsedAccount {
  line: number;
  raw: string;
  payload: AccountPayload;
}

interface ParseIncomingResult {
  records: ParsedAccount[];
  errors: ParseErrorItem[];
}

interface BatchActionDetail {
  id: number;
  account: string;
  ok: boolean;
  message: string;
  fetchedCount?: number;
}

interface AccountMailItem {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  preview: string;
  contentType: string;
  content: string;
  folderKind: 'inbox' | 'junk';
  folderLabel: string;
  isRead: boolean | null;
}

interface FetchActionResult {
  ok: boolean;
  message: string;
  fetchedCount: number;
  messages: AccountMailItem[];
  resolvedMode: ResolvedMailFetchMode;
}

interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string;
}

const SESSION_COOKIE_NAME = 'am_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
const INGEST_TOKEN_HEADER = 'x-ingest-token';
const MAIL_API_TOKEN_HEADER = 'x-mail-api-token';
const INGEST_PATH = '/api/upload/ingest';
const OPEN_MESSAGES_PATH = '/api/open/messages';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAPH_MAIL_FOLDERS_URL = 'https://graph.microsoft.com/v1.0/me/mailFolders';
const OUTLOOK_MAIL_FOLDERS_URL = 'https://outlook.office.com/api/v2.0/me/mailFolders';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';
const DEFAULT_REFRESH_CONCURRENCY = 8;
const MAIL_PAGE_SIZE = 100;
const TOKEN_LIFETIME_DAYS = 90;

const DEFAULT_INGEST_CONFIG: IngestConfig = {
  delimiter: '----',
  captchaField: 'data',
  accountField: 'a',
  passwordField: 'p',
  clientIdField: 'c',
  tokenField: 't'
};

const CLOUD_MAIL_CONFIG_KEY = 'cloud_mail_config';

const DEFAULT_CLOUD_MAIL_CONFIG: CloudMailConfig = {
  apiBaseUrl: '',
  adminEmail: '',
  adminPassword: '',
  availableDomains: []
};

const ACCOUNT_SELECT_SQL = `
  SELECT
    id,
    account,
    password,
    client_id AS clientId,
    refresh_token AS refreshToken,
    remark,
    created_at AS createdAt,
    IFNULL(sync_status, 'idle') AS syncStatus,
    sync_message AS syncMessage,
    refreshed_at AS refreshedAt,
    fetched_at AS fetchedAt,
    IFNULL(fetched_count, 0) AS fetchedCount,
    IFNULL(token_status, 'unknown') AS tokenStatus,
    token_message AS tokenMessage,
    token_checked_at AS tokenCheckedAt
  FROM accounts
`;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors());

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }

  const pathname = new URL(c.req.url).pathname;
  if (isPublicApiPath(pathname)) {
    await next();
    return;
  }

  const authUser = await authenticateRequest(c);
  if (!authUser) {
    throw new HTTPException(401, { message: '未登录或登录已过期' });
  }

  c.set('authUser', authUser);
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/login', async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(c);
  const username = asText(body.username).trim();
  const password = asText(body.password);

  const expectedUsername = getConfiguredUsername(c.env);
  const expectedPassword = getConfiguredPassword(c.env);
  const sessionSecret = getSessionSecret(c.env);

  if (!username || !password) {
    throw new HTTPException(400, { message: '用户名和密码不能为空' });
  }

  if (username !== expectedUsername || !timingSafeEqual(password, expectedPassword)) {
    throw new HTTPException(401, { message: '用户名或密码错误' });
  }

  const token = await createSessionToken(expectedUsername, sessionSecret);
  setCookie(c, SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttpsRequest(c.req.url),
    maxAge: SESSION_MAX_AGE_SECONDS
  });

  return c.json({ ok: true as const, username: expectedUsername });
});

app.get('/api/auth/me', (c) => {
  return c.json({ username: c.get('authUser') });
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: 'Lax',
    secure: isHttpsRequest(c.req.url)
  });
  return c.json({ ok: true as const });
});

app.get('/api/accounts', async (c) => {
  const keyword = (c.req.query('keyword') ?? '').trim();
  const items = await queryAccounts(c.env.DB, keyword);
  return c.json({ items: items.map(serializeAccountRow) });
});

app.get('/api/open/accounts', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const keyword = (c.req.query('keyword') ?? '').trim();
  const items = await queryAccounts(c.env.DB, keyword);
  return c.json({ items: items.map(serializeAccountRow) });
});

app.post('/api/accounts', async (c) => {
  const body = await readJson<Partial<AccountPayload>>(c);
  const payload = normalizeAccountPayload(body, true);

  let insertResult: D1Result;
  try {
    insertResult = await c.env.DB
      .prepare(
        `INSERT INTO accounts (account, password, client_id, refresh_token, remark)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        payload.account,
        payload.password,
        payload.clientId,
        payload.refreshToken,
        payload.remark
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: '账号记录已存在' });
    }
    throw error;
  }

  const lastRowId = Number(insertResult.meta.last_row_id);
  const item = await c.env.DB
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`)
    .bind(lastRowId)
    .first<AccountRow>();

  if (!item) {
    throw new HTTPException(500, { message: '账号创建成功，但读取结果失败' });
  }

  return c.json({ item: serializeAccountRow(item) }, 201);
});

app.put('/api/accounts/:id', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const body = await readJson<Partial<AccountPayload>>(c);
  const payload = normalizeAccountPayload(body, true);

  let result: D1Result;
  try {
    result = await c.env.DB
      .prepare(
        `UPDATE accounts
         SET account = ?, password = ?, client_id = ?, refresh_token = ?, remark = ?
         WHERE id = ?`
      )
      .bind(
        payload.account,
        payload.password,
        payload.clientId,
        payload.refreshToken,
        payload.remark,
        id
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: '账号记录已存在' });
    }
    throw error;
  }

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  const item = await c.env.DB
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`)
    .bind(id)
    .first<AccountRow>();

  if (!item) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ item: serializeAccountRow(item) });
});

app.delete('/api/accounts/:id', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ ok: true as const });
});

app.post('/api/accounts/batch-delete', async (c) => {
  const body = await readJson<{ accountIds?: unknown }>(c);
  const accountIds = parseAccountIds(body.accountIds);
  
  if (accountIds.length === 0) {
    throw new HTTPException(400, { message: '请选择要删除的账号' });
  }

  const placeholders = accountIds.map(() => '?').join(',');
  const result = await c.env.DB
    .prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`)
    .bind(...accountIds)
    .run();

  const deleted = result.meta.changes ?? 0;
  return c.json({
    total: accountIds.length,
    deleted,
    skipped: accountIds.length - deleted
  });
});

app.patch('/api/accounts/:id/remark', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const body = await readJson<{ remark?: unknown }>(c);
  const remark = normalizeRemark(body.remark);

  const item = await updateAccountRemark(c.env.DB, id, remark);
  if (!item) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ item: serializeAccountRow(item) });
});

app.post('/api/accounts/import', async (c) => {
  const body = await readJson<{ text?: string }>(c);
  const text = asText(body.text).trim();
  if (!text) {
    throw new HTTPException(400, { message: '导入内容不能为空' });
  }

  const lines = text.split(/\r?\n/);
  let inserted = 0;
  let skipped = 0;
  const errors: ParseErrorItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) {
      continue;
    }

    let payload: AccountPayload;
    try {
      payload = parseCaptchaLine(raw, DEFAULT_INGEST_CONFIG.delimiter);
    } catch (error) {
      errors.push({
        line: index + 1,
        raw,
        reason: error instanceof Error ? error.message : '格式错误'
      });
      continue;
    }

    try {
      const result = await c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO accounts (account, password, client_id, refresh_token, remark)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          payload.account,
          payload.password,
          toNullableText(payload.clientId),
          toNullableText(payload.refreshToken),
          toNullableText(payload.remark)
        )
        .run();

      if ((result.meta.changes ?? 0) > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors.push({
        line: index + 1,
        raw,
        reason: error instanceof Error ? error.message : '数据库写入失败'
      });
    }
  }

  return c.json({ inserted, skipped, errors });
});

app.post('/api/accounts/refresh', async (c) => {
  const body = await readJson<{ accountIds?: unknown }>(c);
  const accountIds = parseAccountIds(body.accountIds);
  const accounts =
    accountIds.length > 0
      ? await fetchAccountsByIds(c.env.DB, accountIds)
      : await fetchAllAccounts(c.env.DB);

  if (accounts.length === 0) {
    throw new HTTPException(400, { message: '没有可检测的邮箱' });
  }

  const details = await mapWithConcurrency(accounts, DEFAULT_REFRESH_CONCURRENCY, (account) =>
    refreshAccountToken(c.env.DB, account)
  );
  const success = details.filter((item) => item.ok).length;
  return c.json({
    total: details.length,
    success,
    failure: details.length - success,
    details
  });
});

app.get('/api/accounts/:id/messages', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const mode = parseMailFetchMode(c.req.query('mode'), 'auto');
  const account = await fetchAccountById(c.env.DB, id);

  if (!account) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  const result = await fetchAccountMessages(c.env.DB, account, mode, true);
  if (!result.ok) {
    throw new HTTPException(400, { message: result.message });
  }

  return c.json({
    accountId: account.id,
    account: account.account,
    mode,
    resolvedMode: result.resolvedMode,
    messages: result.messages
  });
});

app.get('/api/open/accounts/:id/messages', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const id = parseNumericId(c.req.param('id'));
  const mode = parseMailFetchMode(c.req.query('mode'), 'auto');
  const account = await fetchAccountById(c.env.DB, id);

  if (!account) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  const result = await fetchAccountMessages(c.env.DB, account, mode, true);
  if (!result.ok) {
    throw new HTTPException(400, { message: result.message });
  }

  return c.json({
    accountId: account.id,
    account: account.account,
    mode,
    resolvedMode: result.resolvedMode,
    messages: result.messages
  });
});

app.post('/api/open/messages', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const body = await readJson<{ id?: unknown; account?: unknown; mode?: unknown }>(c);
  const mode = parseMailFetchMode(body.mode, 'auto');

  const rawId = Number.parseInt(asText(body.id), 10);
  const accountById = Number.isInteger(rawId) && rawId > 0 ? await fetchAccountById(c.env.DB, rawId) : null;

  const accountText = asText(body.account).trim();
  const accountByName = accountText ? await fetchAccountByAccount(c.env.DB, accountText) : null;

  const account = accountById ?? accountByName;
  if (!account) {
    throw new HTTPException(400, { message: '请传入有效的 id 或 account' });
  }

  const result = await fetchAccountMessages(c.env.DB, account, mode, true);
  if (!result.ok) {
    throw new HTTPException(400, { message: result.message });
  }

  return c.json({
    accountId: account.id,
    account: account.account,
    mode,
    resolvedMode: result.resolvedMode,
    messages: result.messages
  });
});

app.patch('/api/open/accounts/:id/remark', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const id = parseNumericId(c.req.param('id'));
  const body = await readJson<{ remark?: unknown }>(c);
  const remark = normalizeRemark(body.remark);

  const item = await updateAccountRemark(c.env.DB, id, remark);
  if (!item) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({
    ok: true,
    id: item.id,
    account: item.account,
    remark: item.remark
  });
});

app.delete('/api/open/accounts/:id', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const id = parseNumericId(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ ok: true as const });
});

app.get('/api/ingest-config', async (c) => {
  const item = await getIngestConfig(c.env.DB);
  return c.json({
    item,
    endpointPath: INGEST_PATH,
    tokenHeader: INGEST_TOKEN_HEADER
  });
});

app.put('/api/ingest-config', async (c) => {
  const body = await readJson<Partial<IngestConfig>>(c);
  const item = normalizeIngestConfig(body);
  validateIngestConfig(item);

  await setAppSetting(c.env.DB, 'ingest_config', JSON.stringify(item));

  return c.json({ item });
});

app.get('/api/cloud-mail/config', async (c) => {
  const item = await getCloudMailConfig(c.env.DB);
  return c.json({ item });
});

app.put('/api/cloud-mail/config', async (c) => {
  const body = await readJson<Partial<CloudMailConfig>>(c);
  const item = normalizeCloudMailConfig(body);
  validateCloudMailConfig(item);
  await validateCloudMailConnection(item);
  await setAppSetting(c.env.DB, CLOUD_MAIL_CONFIG_KEY, JSON.stringify(item));
  return c.json({ item });
});

app.get('/api/cloud-mail/accounts', async (c) => {
  const config = await getCloudMailConfig(c.env.DB);
  ensureCloudMailConfigured(config);

  const page = parsePageNumber(c.req.query('page'), 1);
  const pageSize = parsePageNumber(c.req.query('pageSize'), 20, 1, 100);
  const keyword = asText(c.req.query('keyword')).trim();

  const result = await listCloudMailAccounts(config, {
    page,
    pageSize,
    keyword
  });

  return c.json(result);
});

app.get('/api/cloud-mail/messages', async (c) => {
  const config = await getCloudMailConfig(c.env.DB);
  ensureCloudMailConfigured(config);

  const email = asText(c.req.query('email')).trim().toLowerCase();
  if (!email) {
    throw new HTTPException(400, { message: '请传入需要查询的邮箱' });
  }

  const messages = await listCloudMailMessages(config, email);

  return c.json({
    account: email,
    messages
  });
});

app.post('/api/cloud-mail/accounts', async (c) => {
  const config = await getCloudMailConfig(c.env.DB);
  ensureCloudMailConfigured(config);

  const body = await readJson<{
    localPart?: string;
    domain?: string;
  }>(c);
  const payload = normalizeCloudMailCreatePayload(body, config.availableDomains);
  const email = `${payload.localPart}@${payload.domain}`;

  await createCloudMailAccount(config, { email });

  return c.json({
    ok: true as const,
    email
  });
});

app.post('/api/cloud-mail/accounts/batch-delete', async (c) => {
  const config = await getCloudMailConfig(c.env.DB);
  ensureCloudMailConfigured(config);

  const body = await readJson<{ userIds?: unknown }>(c);
  const userIds = parseAccountIds(body.userIds);

  if (userIds.length === 0) {
    throw new HTTPException(400, { message: '请至少选择一个 Cloud Mail 邮箱' });
  }

  await deleteCloudMailAccounts(config, userIds);

  return c.json({
    ok: true as const,
    total: userIds.length,
    deleted: userIds.length,
    skipped: 0
  });
});

app.post('/api/upload/ingest', async (c) => {
  const expectedToken = getIngestToken(c.env);
  const receivedToken = readIngestToken(c);
  if (!receivedToken || !timingSafeEqual(receivedToken, expectedToken)) {
    throw new HTTPException(401, { message: '上传令牌无效' });
  }

  const config = await getIngestConfig(c.env.DB);
  const incomingData = await readIncomingBody(c);
  const parsed = parseIncomingPayload(incomingData, config);

  let inserted = 0;
  let skipped = 0;
  const errors = [...parsed.errors];

  if (parsed.records.length > 5000) {
    throw new HTTPException(400, { message: '单次上传记录不能超过 5000 条' });
  }

  for (const record of parsed.records) {
    try {
      const payload = normalizeAccountPayload(record.payload, true);
      const result = await c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO accounts (account, password, client_id, refresh_token, remark)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          payload.account,
          payload.password,
          toNullableText(payload.clientId),
          toNullableText(payload.refreshToken),
          toNullableText(payload.remark)
        )
        .run();

      if ((result.meta.changes ?? 0) > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors.push({
        line: record.line,
        raw: record.raw,
        reason: error instanceof Error ? error.message : '数据库写入失败'
      });
    }
  }

  const status = inserted === 0 && skipped === 0 && errors.length > 0 ? 400 : 200;
  return c.json({ inserted, skipped, errors }, status);
});

app.all('*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname.startsWith('/api/')) {
    return c.json({ message: '接口不存在' }, 404);
  }

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  if (assetResponse.status !== 404 || c.req.method !== 'GET') {
    return assetResponse;
  }

  const indexUrl = new URL(c.req.url);
  indexUrl.pathname = '/index.html';
  const indexRequest = new Request(indexUrl.toString(), {
    method: 'GET',
    headers: c.req.raw.headers
  });
  return c.env.ASSETS.fetch(indexRequest);
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ message: error.message }, error.status);
  }

  console.error(error);
  return c.json({ message: '服务器内部错误' }, 500);
});

export default app;

async function readJson<T>(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: '请求体必须是合法 JSON' });
  }
}

async function readIncomingBody(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<unknown> {
  const contentType = asText(c.req.header('content-type')).toLowerCase();
  if (contentType.includes('application/json')) {
    return readJson<unknown>(c);
  }

  const text = (await c.req.text()).trim();
  if (!text) {
    throw new HTTPException(400, { message: '上传内容不能为空' });
  }

  return text;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function toNullableText(value: unknown): string | null {
  const text = asText(value).trim();
  return text ? text : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /unique/i.test(error.message);
}

function parseNumericId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: 'ID 非法' });
  }
  return id;
}

function normalizeAccountPayload(input: Partial<AccountPayload>, requireBase: boolean): AccountPayload {
  const account = asText(input.account).trim();
  const password = asText(input.password).trim();

  if (requireBase && (!account || !password)) {
    throw new HTTPException(400, { message: '账号和密码不能为空' });
  }

  const payload: AccountPayload = {
    account,
    password,
    clientId: asText(input.clientId).trim(),
    refreshToken: asText(input.refreshToken).trim(),
    remark: asText(input.remark).trim()
  };

  if (payload.account.length > 255 || payload.password.length > 255) {
    throw new HTTPException(400, { message: '账号或密码长度超过限制' });
  }

  return payload;
}

function normalizeRemark(input: unknown): string | null {
  const remark = asText(input).trim();
  if (remark.length > 500) {
    throw new HTTPException(400, { message: '备注长度不能超过 500' });
  }
  return remark || null;
}

function parseCaptchaLine(line: string, delimiter: string): AccountPayload {
  const parts = line.split(delimiter).map((item) => item.trim());
  if (parts.length < 2 || parts.length > 4) {
    throw new Error(
      `格式应为 账号${delimiter}密码 或 账号${delimiter}密码${delimiter}client_id${delimiter}refresh_token`
    );
  }

  const [account, password, clientId = '', refreshToken = ''] = parts;
  if (!account || !password) {
    throw new Error('账号和密码不能为空');
  }

  return {
    account,
    password,
    clientId,
    refreshToken,
    remark: ''
  };
}

async function getAppSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1')
    .bind(key)
    .first<{ value: string }>();

  return row?.value ?? null;
}

async function setAppSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key)
       DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .bind(key, value)
    .run();
}

async function getIngestConfig(db: D1Database): Promise<IngestConfig> {
  const value = await getAppSetting(db, 'ingest_config');

  if (!value) {
    return DEFAULT_INGEST_CONFIG;
  }

  try {
    const parsed = JSON.parse(value) as Partial<IngestConfig>;
    return normalizeIngestConfig(parsed);
  } catch {
    return DEFAULT_INGEST_CONFIG;
  }
}

async function getCloudMailConfig(db: D1Database): Promise<CloudMailConfig> {
  const value = await getAppSetting(db, CLOUD_MAIL_CONFIG_KEY);

  if (!value) {
    return DEFAULT_CLOUD_MAIL_CONFIG;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CloudMailConfig>;
    return normalizeCloudMailConfig(parsed);
  } catch {
    return DEFAULT_CLOUD_MAIL_CONFIG;
  }
}

function normalizeIngestConfig(input: Partial<IngestConfig>): IngestConfig {
  return {
    delimiter: asText(input.delimiter).trim() || DEFAULT_INGEST_CONFIG.delimiter,
    captchaField: normalizeFieldName(input.captchaField, DEFAULT_INGEST_CONFIG.captchaField),
    accountField: normalizeFieldName(input.accountField, DEFAULT_INGEST_CONFIG.accountField),
    passwordField: normalizeFieldName(input.passwordField, DEFAULT_INGEST_CONFIG.passwordField),
    clientIdField: normalizeFieldName(input.clientIdField, DEFAULT_INGEST_CONFIG.clientIdField),
    tokenField: normalizeFieldName(input.tokenField, DEFAULT_INGEST_CONFIG.tokenField)
  };
}

function normalizeFieldName(value: unknown, fallback: string): string {
  const text = asText(value).trim();
  if (!text) {
    return fallback;
  }
  return text;
}

function validateIngestConfig(config: IngestConfig): void {
  if (config.delimiter.length < 1 || config.delimiter.length > 12) {
    throw new HTTPException(400, { message: '分隔符长度必须在 1 到 12 之间' });
  }

  const fields = [
    config.captchaField,
    config.accountField,
    config.passwordField,
    config.clientIdField,
    config.tokenField
  ];

  for (const field of fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field)) {
      throw new HTTPException(400, { message: `字段名不合法: ${field}` });
    }
  }
}

function normalizeCloudMailConfig(input: Partial<CloudMailConfig>): CloudMailConfig {
  return {
    apiBaseUrl: normalizeCloudMailBaseUrl(input.apiBaseUrl),
    adminEmail: asText(input.adminEmail).trim().toLowerCase(),
    adminPassword: asText(input.adminPassword).trim(),
    availableDomains: normalizeCloudMailDomains(input.availableDomains)
  };
}

function normalizeCloudMailBaseUrl(value: unknown): string {
  const raw = asText(value).trim();
  if (!raw) {
    return '';
  }

  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    url.search = '';
    url.hash = '';
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return raw;
  }
}

function normalizeCloudMailDomains(value: unknown): string[] {
  const segments = Array.isArray(value)
    ? value.map((item) => asText(item))
    : asText(value)
        .split(/[\n,]/)
        .map((item) => item);

  return Array.from(
    new Set(
      segments
        .map((item) => asText(item).trim().toLowerCase().replace(/^@+/, ''))
        .filter(Boolean)
    )
  );
}

function validateCloudMailConfig(config: CloudMailConfig): void {
  if (!config.apiBaseUrl || !config.adminEmail || !config.adminPassword) {
    throw new HTTPException(400, { message: '请完整填写 API URI、管理员邮箱和管理员密码' });
  }

  if (config.apiBaseUrl.length > 500) {
    throw new HTTPException(400, { message: 'API URI 长度不能超过 500 个字符' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(config.apiBaseUrl);
  } catch {
    throw new HTTPException(400, { message: 'API URI 格式不合法' });
  }

  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new HTTPException(400, { message: 'API URI 必须以 http:// 或 https:// 开头' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail)) {
    throw new HTTPException(400, { message: '管理员邮箱格式不合法' });
  }

  if (config.adminPassword.length > 255) {
    throw new HTTPException(400, { message: '管理员密码长度不能超过 255 个字符' });
  }

  for (const domain of config.availableDomains) {
    if (domain.length > 255) {
      throw new HTTPException(400, { message: `域名长度不能超过 255 个字符: ${domain}` });
    }

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      throw new HTTPException(400, { message: `可用域名格式不合法: ${domain}` });
    }
  }
}

function ensureCloudMailConfigured(config: CloudMailConfig): void {
  if (!config.apiBaseUrl || !config.adminEmail || !config.adminPassword) {
    throw new HTTPException(400, { message: '请先完成 Cloud Mail 配置' });
  }
}

function parsePageNumber(
  value: string | undefined,
  fallback: number,
  min = 1,
  max = Number.POSITIVE_INFINITY
): number {
  const parsed = Number.parseInt(asText(value), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function normalizeCloudMailCreatePayload(
  input: { localPart?: string; domain?: string },
  availableDomains: string[]
): { localPart: string; domain: string } {
  const localPart = asText(input.localPart).trim().toLowerCase();
  const domain = asText(input.domain).trim().toLowerCase().replace(/^@+/, '');

  if (!localPart || !domain) {
    throw new HTTPException(400, { message: '请完整填写邮箱前缀并选择域名' });
  }

  if (!/^[a-z0-9._%+-]+$/i.test(localPart)) {
    throw new HTTPException(400, { message: '邮箱前缀只能包含字母、数字和常见邮箱字符' });
  }

  if (!availableDomains.includes(domain)) {
    throw new HTTPException(400, { message: '所选域名不在可用域名列表中' });
  }

  return {
    localPart,
    domain
  };
}

async function validateCloudMailConnection(config: CloudMailConfig): Promise<void> {
  await getCloudMailAdminToken(config);
  await getCloudMailPublicToken(config);
}

function buildCloudMailUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | null | undefined>
): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(path.replace(/^\/+/, ''), normalizedBase);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function isCloudMailSuccessCode(code: unknown): boolean {
  const normalized = asText(code).trim();
  return !normalized || normalized === '200' || normalized === '0';
}

function resolveCloudMailErrorMessage(payload: CloudMailRemoteEnvelope<unknown>, status: number): string {
  const remoteMessage = asText(payload.message).trim();
  if (remoteMessage) {
    return remoteMessage;
  }

  if (status >= 500) {
    return 'Cloud Mail 服务暂时不可用，请稍后重试';
  }

  return `Cloud Mail 请求失败 (${status})`;
}

async function requestCloudMail<T>(
  config: CloudMailConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(buildCloudMailUrl(config.apiBaseUrl, path), {
      ...init,
      headers
    });
  } catch {
    throw new HTTPException(502, { message: 'Cloud Mail 服务连接失败，请检查 API URI' });
  }

  const rawText = await response.text();
  let payload: CloudMailRemoteEnvelope<T> = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as CloudMailRemoteEnvelope<T>;
    } catch {
      payload = {
        code: response.ok ? 200 : response.status,
        message: response.ok ? '' : rawText,
        data: rawText as T
      };
    }
  }

  if (!response.ok) {
    throw new HTTPException(response.status >= 500 ? 502 : 400, {
      message: resolveCloudMailErrorMessage(payload, response.status)
    });
  }

  if (!isCloudMailSuccessCode(payload.code)) {
    throw new HTTPException(400, {
      message: resolveCloudMailErrorMessage(payload, response.status)
    });
  }

  return payload.data as T;
}

function resolveCloudMailToken(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim();
  }

  if (!data || typeof data !== 'object') {
    return '';
  }

  const record = data as Record<string, unknown>;
  return asText(record.token ?? record.jwt ?? record.accessToken ?? record.authorization).trim();
}

function wrapCloudMailTokenError(error: unknown, context: 'admin' | 'public'): never {
  const originalMessage =
    error instanceof HTTPException
      ? error.message
      : error instanceof Error
        ? error.message
        : '';

  const message = originalMessage.trim();
  const prefix = context === 'admin' ? 'Cloud Mail 管理员认证失败' : 'Cloud Mail 公开接口认证失败';

  if (!message) {
    throw new HTTPException(502, { message: `${prefix}，请检查配置信息` });
  }

  if (message.includes('输入的邮箱不存在')) {
    throw new HTTPException(400, { message: 'Cloud Mail 管理员邮箱不存在，请检查配置信息' });
  }

  if (message.includes('密码')) {
    throw new HTTPException(400, { message: 'Cloud Mail 管理员密码错误，请检查配置信息' });
  }

  if (message.includes('API URI') || message.includes('连接失败')) {
    throw new HTTPException(502, { message: 'Cloud Mail 服务连接失败，请检查 API URI' });
  }

  if (message.startsWith('Cloud Mail ')) {
    throw new HTTPException(error instanceof HTTPException ? error.status : 400, { message });
  }

  throw new HTTPException(error instanceof HTTPException ? error.status : 400, {
    message: `${prefix}：${message}`
  });
}

async function getCloudMailAdminToken(config: CloudMailConfig): Promise<string> {
  let data: unknown;
  try {
    data = await requestCloudMail<unknown>(config, '/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: config.adminEmail,
        password: config.adminPassword
      })
    });
  } catch (error) {
    wrapCloudMailTokenError(error, 'admin');
  }

  const token = resolveCloudMailToken(data);
  if (!token) {
    throw new HTTPException(502, { message: 'Cloud Mail 管理员认证成功但未返回有效令牌' });
  }

  return token;
}

async function getCloudMailPublicToken(config: CloudMailConfig): Promise<string> {
  let data: unknown;
  try {
    data = await requestCloudMail<unknown>(config, '/api/public/genToken', {
      method: 'POST',
      body: JSON.stringify({
        email: config.adminEmail,
        password: config.adminPassword
      })
    });
  } catch (error) {
    wrapCloudMailTokenError(error, 'public');
  }

  const token = resolveCloudMailToken(data);
  if (!token) {
    throw new HTTPException(502, { message: 'Cloud Mail 公开接口认证成功但未返回有效令牌' });
  }

  return token;
}

function toCloudMailNumber(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(asText(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCloudMailStatus(value: unknown): number {
  const text = asText(value).trim().toLowerCase();
  if (!text) {
    return 1;
  }

  if (text === '1' || text === 'true' || text === 'enabled' || text === 'active' || text === 'normal') {
    return 1;
  }

  if (text === '0' || text === 'false' || text === 'disabled' || text === 'inactive' || text === 'ban') {
    return 0;
  }

  const numeric = Number.parseInt(text, 10);
  return Number.isFinite(numeric) ? numeric : 1;
}

function toCloudMailAccountItem(input: unknown): CloudMailAccountItem | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const row = input as Record<string, unknown>;
  const userId = toCloudMailNumber(row.userId ?? row.id, 0);
  const email = asText(row.email ?? row.username ?? row.account).trim();

  if (!userId || !email) {
    return null;
  }

  return {
    userId,
    email,
    status: parseCloudMailStatus(row.status ?? row.userStatus ?? row.isEnable),
    receiveEmailCount: toCloudMailNumber(
      row.receiveEmailCount ?? row.receiveCount ?? row.receiveEmailNum ?? row.recvCount,
      0
    ),
    sendEmailCount: toCloudMailNumber(row.sendEmailCount ?? row.sendCount ?? row.sendEmailNum ?? row.sentCount, 0),
    activeTime: toNullableText(
      row.activeTime ?? row.updateTime ?? row.lastActiveTime ?? row.lastLoginTime ?? row.updatedAt
    ),
    createTime: toNullableText(row.createTime ?? row.createdAt ?? row.createAt ?? row.insertTime)
  };
}

function normalizeCloudMailListPayload(
  payload: unknown,
  page: number,
  pageSize: number
): CloudMailListResponse {
  let rawItems: unknown[] = [];
  let total = 0;

  if (Array.isArray(payload)) {
    rawItems = payload;
    total = payload.length;
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const candidates = [record.list, record.rows, record.records, record.items, record.data];
    const listCandidate = candidates.find((item) => Array.isArray(item));
    rawItems = Array.isArray(listCandidate) ? listCandidate : [];
    total = toCloudMailNumber(
      record.total ?? record.count ?? record.totalCount ?? record.itemTotal ?? record.pageTotal,
      rawItems.length
    );
  }

  const items = rawItems.map((item) => toCloudMailAccountItem(item)).filter(Boolean) as CloudMailAccountItem[];

  return {
    items,
    total: total || items.length,
    page,
    pageSize
  };
}

async function listCloudMailAccounts(
  config: CloudMailConfig,
  options: { page: number; pageSize: number; keyword: string }
): Promise<CloudMailListResponse> {
  const token = await getCloudMailAdminToken(config);
  const params = new URLSearchParams({
    num: String(options.page),
    size: String(options.pageSize),
    status: '-1',
    isDel: '0'
  });
  if (options.keyword) {
    params.set('email', options.keyword);
  }

  const data = await requestCloudMail<unknown>(config, `/api/user/list?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: token
    }
  });

  return normalizeCloudMailListPayload(data, options.page, options.pageSize);
}

async function createCloudMailAccount(
  config: CloudMailConfig,
  payload: { email: string }
): Promise<void> {
  const token = await getCloudMailPublicToken(config);
  await requestCloudMail(config, '/api/public/addUser', {
    method: 'POST',
    headers: {
      Authorization: token
    },
    body: JSON.stringify({
      list: [
        {
          email: payload.email
        }
      ]
    })
  });
}

function normalizeCloudMailTimestamp(value: unknown): string {
  const text = asText(value).trim();
  if (!text) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return `${text.replace(' ', 'T')}Z`;
  }

  return text;
}

function detectCloudMailContentType(html: string, text: string): string {
  if (html && /<\/?[a-z][\s\S]*>/i.test(html)) {
    return 'html';
  }

  if (text) {
    return 'text';
  }

  return html ? 'html' : '';
}

function formatMailboxDisplay(name: string, email: string): string {
  const normalizedName = name.trim();
  const normalizedEmail = email.trim();
  if (normalizedName && normalizedEmail && normalizedName !== normalizedEmail) {
    return `${normalizedName} <${normalizedEmail}>`;
  }
  return normalizedEmail || normalizedName;
}

function normalizeCloudMailFolderKind(row: Record<string, unknown>): 'inbox' | 'junk' {
  const candidates = [
    row.folderKind,
    row.folderType,
    row.folder,
    row.mailFolder,
    row.boxType,
    row.typeName
  ];

  for (const candidate of candidates) {
    const text = asText(candidate).trim().toLowerCase();
    if (!text) {
      continue;
    }
    if (['junk', 'junkemail', 'junk_email', 'spam', 'trashspam'].includes(text)) {
      return 'junk';
    }
    if (['inbox', 'in_box', 'mailinbox'].includes(text)) {
      return 'inbox';
    }
  }

  const numericCandidates = [row.type, row.boxType, row.folderTypeCode];
  for (const candidate of numericCandidates) {
    const text = asText(candidate).trim();
    if (!text) {
      continue;
    }
    if (text === '1') {
      return 'junk';
    }
    if (text === '0') {
      return 'inbox';
    }
  }

  return 'inbox';
}

function normalizeCloudMailReadState(row: Record<string, unknown>): boolean | null {
  const candidates = [row.isRead, row.read, row.readFlag, row.seen, row.isSeen, row.status];

  for (const candidate of candidates) {
    if (typeof candidate === 'boolean') {
      return candidate;
    }

    const text = asText(candidate).trim().toLowerCase();
    if (!text) {
      continue;
    }
    if (['1', 'true', 'yes', 'read', 'seen'].includes(text)) {
      return true;
    }
    if (['0', 'false', 'no', 'unread', 'new'].includes(text)) {
      return false;
    }
  }

  return null;
}

function detectGraphReadState(value: unknown): boolean | null {
  return normalizeMicrosoftReadState(value);
}

function detectOutlookReadState(value: unknown): boolean | null {
  return normalizeMicrosoftReadState(value);
}

function normalizeMicrosoftReadState(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (!text) {
      return null;
    }

    if (['true', '1', 'yes', 'read', 'seen'].includes(text)) {
      return true;
    }
    if (['false', '0', 'no', 'unread', 'new'].includes(text)) {
      return false;
    }
  }

  return null;
}

function toCloudMailMailItem(input: unknown): AccountMailItem | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const row = input as Record<string, unknown>;
  const subject = asText(row.subject ?? row.title).trim();
  const senderEmail = asText(row.sendEmail ?? row.fromEmail ?? row.from).trim();
  const senderName = asText(row.sendName ?? row.fromName).trim();
  const rawHtml = asText(row.content ?? row.htmlContent ?? row.body).trim();
  const rawText = asText(row.text ?? row.preview ?? row.contentText).trim();
  const receivedAt = normalizeCloudMailTimestamp(
    row.createTime ?? row.receivedAt ?? row.sendTime ?? row.createdAt
  );
  const id =
    asText(row.emailId ?? row.id).trim() ||
    `${senderEmail || senderName}-${receivedAt}-${subject || rawText.slice(0, 24)}`;

  const folderKind = normalizeCloudMailFolderKind(row);
  const from = formatMailboxDisplay(senderName, senderEmail);

  return {
    id,
    subject,
    from,
    receivedAt,
    preview: rawText || rawHtml,
    contentType: detectCloudMailContentType(rawHtml, rawText),
    content: rawHtml || rawText,
    folderKind,
    folderLabel: getFolderLabel(folderKind),
    isRead: normalizeCloudMailReadState(row)
  };
}

function normalizeCloudMailMessagesPayload(payload: unknown): AccountMailItem[] {
  let rawItems: unknown[] = [];

  if (Array.isArray(payload)) {
    rawItems = payload;
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const candidates = [record.list, record.rows, record.records, record.items, record.data];
    const listCandidate = candidates.find((item) => Array.isArray(item));
    rawItems = Array.isArray(listCandidate) ? listCandidate : [];
  }

  return sortMailMessages(
    rawItems.map((item) => toCloudMailMailItem(item)).filter(Boolean) as AccountMailItem[]
  );
}

async function listCloudMailMessages(config: CloudMailConfig, email: string): Promise<AccountMailItem[]> {
  const token = await getCloudMailPublicToken(config);
  const data = await requestCloudMail<unknown>(config, '/api/public/emailList', {
    method: 'POST',
    headers: {
      Authorization: token
    },
    body: JSON.stringify({
      toEmail: email,
      type: 0,
      isDel: 0,
      timeSort: 'desc',
      num: 1,
      size: MAIL_PAGE_SIZE
    })
  });

  return normalizeCloudMailMessagesPayload(data);
}

async function deleteCloudMailAccounts(config: CloudMailConfig, userIds: number[]): Promise<void> {
  const token = await getCloudMailAdminToken(config);
  await requestCloudMail(
    config,
    `/api/user/delete?${new URLSearchParams({ userIds: userIds.join(',') }).toString()}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: token
      }
    }
  );
}

function parseAccountIds(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const ids = input
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  return Array.from(new Set(ids));
}

function parseMailFetchMode(value: unknown, fallback: MailFetchMode): MailFetchMode {
  const mode = asText(value).trim().toLowerCase();
  if (mode === 'auto' || mode === 'imap' || mode === 'graph') {
    return mode;
  }
  return fallback;
}

function getScopeByMode(mode: MailFetchMode): string {
  if (mode === 'imap') {
    return IMAP_SCOPE;
  }
  return GRAPH_SCOPE;
}

function serializeAccountRow(row: AccountRow): AccountRow & {
  tokenBaseAt: string | null;
  tokenCountdownDays: number | null;
} {
  const tokenBaseAt = row.refreshedAt || row.createdAt || null;
  return {
    ...row,
    tokenBaseAt,
    tokenCountdownDays: calculateTokenCountdownDays(tokenBaseAt)
  };
}

function calculateTokenCountdownDays(tokenBaseAt: string | null): number | null {
  if (!tokenBaseAt) {
    return null;
  }

  const baseAt = new Date(tokenBaseAt);
  if (Number.isNaN(baseAt.getTime())) {
    return null;
  }

  const elapsedDays = Math.max(0, Math.floor((Date.now() - baseAt.getTime()) / (24 * 60 * 60 * 1000)));
  return Math.max(0, TOKEN_LIFETIME_DAYS - elapsedDays);
}

async function queryAccounts(db: D1Database, keyword: string): Promise<AccountRow[]> {
  let statement: D1PreparedStatement;

  if (keyword) {
    const like = `%${keyword}%`;
    statement = db
      .prepare(
        `${ACCOUNT_SELECT_SQL}
         WHERE account LIKE ?
         ORDER BY id DESC`
      )
      .bind(like);
  } else {
    statement = db.prepare(`${ACCOUNT_SELECT_SQL} ORDER BY id DESC`);
  }

  const { results } = await statement.all<AccountRow>();
  return results ?? [];
}

async function fetchAllAccounts(db: D1Database): Promise<AccountRow[]> {
  const { results } = await db.prepare(`${ACCOUNT_SELECT_SQL} ORDER BY id DESC`).all<AccountRow>();
  return results ?? [];
}

async function fetchAccountById(db: D1Database, id: number): Promise<AccountRow | null> {
  const row = await db.prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`).bind(id).first<AccountRow>();
  return row ?? null;
}

async function updateAccountRemark(db: D1Database, id: number, remark: string | null): Promise<AccountRow | null> {
  const result = await db.prepare('UPDATE accounts SET remark = ? WHERE id = ?').bind(remark, id).run();
  if ((result.meta.changes ?? 0) === 0) {
    return null;
  }
  return fetchAccountById(db, id);
}

async function fetchAccountByAccount(db: D1Database, account: string): Promise<AccountRow | null> {
  const row = await db
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE account = ? ORDER BY id DESC LIMIT 1`)
    .bind(account)
    .first<AccountRow>();
  return row ?? null;
}

async function fetchAccountsByIds(db: D1Database, ids: number[]): Promise<AccountRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(',');
  const statement = db
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id IN (${placeholders}) ORDER BY id DESC`)
    .bind(...ids);
  const { results } = await statement.all<AccountRow>();
  return results ?? [];
}

async function updateTokenState(
  db: D1Database,
  accountId: number,
  params: {
    status: TokenStatus;
    message: string;
    touchRefresh: boolean;
    refreshToken?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE accounts
       SET
         refresh_token = COALESCE(?, refresh_token),
         token_status = ?,
         token_message = ?,
         token_checked_at = CURRENT_TIMESTAMP,
         refreshed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE refreshed_at END
       WHERE id = ?`
    )
    .bind(
      params.refreshToken ?? null,
      params.status,
      truncate(params.message, 600),
      params.touchRefresh ? 1 : 0,
      accountId
    )
    .run();
}

function sortMailMessages(messages: AccountMailItem[]): AccountMailItem[] {
  return [...messages].sort((left, right) => {
    const leftTime = Date.parse(left.receivedAt);
    const rightTime = Date.parse(right.receivedAt);

    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
      return right.id.localeCompare(left.id);
    }
    if (Number.isNaN(leftTime)) {
      return 1;
    }
    if (Number.isNaN(rightTime)) {
      return -1;
    }
    return rightTime - leftTime;
  });
}

async function refreshAccountToken(db: D1Database, account: AccountRow): Promise<BatchActionDetail> {
  if (!account.clientId || !account.refreshToken) {
    const message = '缺少 client_id 或 refresh_token';
    await updateTokenState(db, account.id, {
      status: 'invalid',
      message,
      touchRefresh: false
    });
    await updateSyncStatus(db, account.id, {
      status: 'refresh_failed',
      message,
      touchRefresh: false,
      touchFetch: false,
      fetchedCount: account.fetchedCount
    });
    return {
      id: account.id,
      account: account.account,
      ok: false,
      message
    };
  }

  const exchanged = await exchangeMicrosoftToken(account.refreshToken, account.clientId);
  if (!exchanged.ok) {
    const message = exchanged.error || '刷新失败';
    await updateTokenState(db, account.id, {
      status: 'invalid',
      message,
      touchRefresh: false
    });
    await updateSyncStatus(db, account.id, {
      status: 'refresh_failed',
      message,
      touchRefresh: false,
      touchFetch: false,
      fetchedCount: account.fetchedCount
    });
    return {
      id: account.id,
      account: account.account,
      ok: false,
      message
    };
  }

  const tokenResult = exchanged.result;
  const newRefreshToken = tokenResult.refreshToken || account.refreshToken;
  const message = 'Token 有效，已完成刷新';
  await updateTokenState(db, account.id, {
    status: 'valid',
    message,
    touchRefresh: true,
    refreshToken: newRefreshToken
  });
  await updateSyncStatus(db, account.id, {
    status: 'refresh_success',
    message,
    touchRefresh: false,
    touchFetch: false,
    fetchedCount: account.fetchedCount
  });

  return {
    id: account.id,
    account: account.account,
    ok: true,
    message
  };
}

async function fetchAccountMessages(
  db: D1Database,
  account: AccountRow,
  mode: MailFetchMode,
  includeBody = true
): Promise<FetchActionResult> {
  if (!account.clientId || !account.refreshToken) {
    const message = '缺少 client_id 或 refresh_token';
    await updateTokenState(db, account.id, {
      status: 'invalid',
      message,
      touchRefresh: false
    });
    await updateSyncStatus(db, account.id, {
      status: 'fetch_failed',
      message,
      touchRefresh: false,
      touchFetch: true,
      fetchedCount: 0
    });
    return {
      ok: false,
      message,
      fetchedCount: 0,
      messages: [],
      resolvedMode: 'graph'
    };
  }

  const attemptModes: ResolvedMailFetchMode[] = mode === 'auto' ? ['graph', 'imap'] : [mode];
  const failures: string[] = [];
  let latestRefreshToken = account.refreshToken;
  let tokenExchangeSucceeded = false;
  let lastResolvedMode: ResolvedMailFetchMode = attemptModes[0];

  for (const resolvedMode of attemptModes) {
    lastResolvedMode = resolvedMode;
    const attempt = await attemptMailFetch(
      account.clientId,
      latestRefreshToken,
      resolvedMode,
      includeBody
    );

    latestRefreshToken = attempt.refreshToken;
    tokenExchangeSucceeded = tokenExchangeSucceeded || attempt.tokenExchangeSucceeded;

    if (attempt.ok) {
      const message = `取件成功(${resolvedMode.toUpperCase()})，共 ${attempt.fetchedCount} 封`;
      await updateTokenState(db, account.id, {
        status: 'valid',
        message: `Token 有效，已通过 ${resolvedMode.toUpperCase()} 校验`,
        touchRefresh: true,
        refreshToken: latestRefreshToken
      });
      await updateSyncStatus(db, account.id, {
        status: 'fetch_success',
        message,
        touchRefresh: false,
        touchFetch: true,
        fetchedCount: attempt.fetchedCount
      });
      return {
        ok: true,
        message,
        fetchedCount: attempt.fetchedCount,
        messages: attempt.messages,
        resolvedMode
      };
    }

    failures.push(`${resolvedMode.toUpperCase()}：${attempt.message}`);
  }

  const message =
    mode === 'auto' ? `自动取件失败：${failures.join('；')}` : failures[0] || '取件失败';

  await updateTokenState(db, account.id, {
    status: tokenExchangeSucceeded ? 'valid' : 'invalid',
    message: tokenExchangeSucceeded ? 'Token 有效，但本次邮件拉取失败' : message,
    touchRefresh: tokenExchangeSucceeded,
    refreshToken: latestRefreshToken
  });
  await updateSyncStatus(db, account.id, {
    status: 'fetch_failed',
    message,
    touchRefresh: false,
    touchFetch: true,
    fetchedCount: 0
  });

  return {
    ok: false,
    message,
    fetchedCount: 0,
    messages: [],
    resolvedMode: lastResolvedMode
  };
}

async function attemptMailFetch(
  clientId: string,
  refreshToken: string,
  mode: ResolvedMailFetchMode,
  includeBody: boolean
): Promise<
  | {
      ok: true;
      tokenExchangeSucceeded: true;
      refreshToken: string;
      fetchedCount: number;
      messages: AccountMailItem[];
    }
  | {
      ok: false;
      tokenExchangeSucceeded: boolean;
      refreshToken: string;
      message: string;
    }
> {
  const exchanged = await exchangeMicrosoftToken(refreshToken, clientId, getScopeByMode(mode));
  if (!exchanged.ok) {
    return {
      ok: false,
      tokenExchangeSucceeded: false,
      refreshToken,
      message: exchanged.error || `${mode.toUpperCase()}取件前刷新令牌失败`
    };
  }

  const nextRefreshToken = exchanged.result.refreshToken || refreshToken;
  const fetched =
    mode === 'imap'
      ? await readImapMessagesViaOutlookApi(exchanged.result.accessToken, includeBody)
      : await readGraphMessages(exchanged.result.accessToken, includeBody);

  if (!fetched.ok) {
    return {
      ok: false,
      tokenExchangeSucceeded: true,
      refreshToken: nextRefreshToken,
      message: fetched.error || `${mode.toUpperCase()}取件失败`
    };
  }

  return {
    ok: true,
    tokenExchangeSucceeded: true,
    refreshToken: nextRefreshToken,
    fetchedCount: fetched.messages.length,
    messages: sortMailMessages(fetched.messages)
  };
}

async function exchangeMicrosoftToken(
  refreshToken: string,
  clientId: string,
  scope = ''
): Promise<{ ok: true; result: TokenExchangeResult } | { ok: false; error: string }> {
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', refreshToken);
  if (scope) {
    params.set('scope', scope);
  }

  let response: Response;
  try {
    response = await fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
  } catch (error) {
    return {
      ok: false,
      error: `刷新请求异常: ${error instanceof Error ? error.message : 'unknown error'}`
    };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: extractMicrosoftError(payload, response.status)
    };
  }

  const accessToken = asText((payload as Record<string, unknown>).access_token).trim();
  if (!accessToken) {
    return {
      ok: false,
      error: '刷新响应缺少 access_token'
    };
  }

  return {
    ok: true,
    result: {
      accessToken,
      refreshToken: asText((payload as Record<string, unknown>).refresh_token).trim()
    }
  };
}

async function readGraphMessages(
  accessToken: string,
  includeBody = false
): Promise<{ ok: true; messages: AccountMailItem[] } | { ok: false; error: string }> {
  const [inbox, junk] = await Promise.all([
    readGraphFolderMessages(accessToken, 'inbox', 'inbox', includeBody),
    readGraphFolderMessages(accessToken, 'junkemail', 'junk', includeBody)
  ]);

  if (!inbox.ok) {
    return inbox;
  }
  if (!junk.ok) {
    return junk;
  }

  return {
    ok: true,
    messages: sortMailMessages([...inbox.messages, ...junk.messages])
  };
}

async function readImapMessagesViaOutlookApi(
  accessToken: string,
  includeBody = false
): Promise<{ ok: true; messages: AccountMailItem[] } | { ok: false; error: string }> {
  const [inbox, junk] = await Promise.all([
    readOutlookFolderMessages(accessToken, 'inbox', 'inbox', includeBody),
    readOutlookFolderMessages(accessToken, 'junkemail', 'junk', includeBody)
  ]);

  if (!inbox.ok) {
    return inbox;
  }
  if (!junk.ok) {
    return junk;
  }

  return {
    ok: true,
    messages: sortMailMessages([...inbox.messages, ...junk.messages])
  };
}

async function readGraphFolderMessages(
  accessToken: string,
  folderId: string,
  folderKind: 'inbox' | 'junk',
  includeBody = false
): Promise<{ ok: true; messages: AccountMailItem[] } | { ok: false; error: string }> {
  const select = includeBody
    ? 'id,subject,from,receivedDateTime,bodyPreview,body,isRead'
    : 'id,subject,from,receivedDateTime,bodyPreview,isRead';

  const firstUrl = new URL(`${GRAPH_MAIL_FOLDERS_URL}/${folderId}/messages`);
  firstUrl.searchParams.set('$top', String(MAIL_PAGE_SIZE));
  firstUrl.searchParams.set('$orderby', 'receivedDateTime desc');
  firstUrl.searchParams.set('$select', select);

  const allMessages: AccountMailItem[] = [];
  let nextUrl: string | null = firstUrl.toString();

  while (nextUrl) {
    let response: Response;
    try {
      response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
    } catch (error) {
      return {
        ok: false,
        error: `Graph请求异常: ${error instanceof Error ? error.message : 'unknown error'}`
      };
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: extractMicrosoftError(payload, response.status)
      };
    }

    const value = (payload as Record<string, unknown>).value;
    if (!Array.isArray(value)) {
      return {
        ok: false,
        error: 'Graph响应格式错误，缺少value数组'
      };
    }

    allMessages.push(
      ...value
        .filter((item) => !!item && typeof item === 'object')
        .map((item) =>
          normalizeGraphMailItem(item as Record<string, unknown>, includeBody, folderKind)
        )
    );

    const nextLink = asText((payload as Record<string, unknown>)['@odata.nextLink']).trim();
    nextUrl = nextLink || null;
  }

  return {
    ok: true,
    messages: allMessages
  };
}

async function readOutlookFolderMessages(
  accessToken: string,
  folderId: string,
  folderKind: 'inbox' | 'junk',
  includeBody = false
): Promise<{ ok: true; messages: AccountMailItem[] } | { ok: false; error: string }> {
  const select = includeBody
    ? 'Id,Subject,From,DateTimeReceived,BodyPreview,Body,IsRead'
    : 'Id,Subject,From,DateTimeReceived,BodyPreview,IsRead';

  const firstUrl = new URL(`${OUTLOOK_MAIL_FOLDERS_URL}/${folderId}/messages`);
  firstUrl.searchParams.set('$top', String(MAIL_PAGE_SIZE));
  firstUrl.searchParams.set('$orderby', 'DateTimeReceived desc');
  firstUrl.searchParams.set('$select', select);

  const allMessages: AccountMailItem[] = [];
  let nextUrl: string | null = firstUrl.toString();

  while (nextUrl) {
    let response: Response;
    try {
      response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
    } catch (error) {
      return {
        ok: false,
        error: `IMAP请求异常: ${error instanceof Error ? error.message : 'unknown error'}`
      };
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: extractMicrosoftError(payload, response.status)
      };
    }

    const value = (payload as Record<string, unknown>).value;
    if (!Array.isArray(value)) {
      return {
        ok: false,
        error: 'IMAP响应格式错误，缺少value数组'
      };
    }

    allMessages.push(
      ...value
        .filter((item) => !!item && typeof item === 'object')
        .map((item) =>
          normalizeOutlookMailItem(item as Record<string, unknown>, includeBody, folderKind)
        )
    );

    const nextLink = asText((payload as Record<string, unknown>)['@odata.nextLink']).trim();
    const fallbackNextLink = asText((payload as Record<string, unknown>)['odata.nextLink']).trim();
    nextUrl = nextLink || fallbackNextLink || null;
  }

  return {
    ok: true,
    messages: allMessages
  };
}

function normalizeGraphMailItem(
  item: Record<string, unknown>,
  includeBody: boolean,
  folderKind: 'inbox' | 'junk'
): AccountMailItem {
  const fromNode = item.from;
  let senderName = '';
  let senderAddress = '';
  if (fromNode && typeof fromNode === 'object') {
    const mailAddressNode = (fromNode as Record<string, unknown>).emailAddress;
    if (mailAddressNode && typeof mailAddressNode === 'object') {
      senderName = asText((mailAddressNode as Record<string, unknown>).name).trim();
      senderAddress = asText((mailAddressNode as Record<string, unknown>).address).trim();
    }
  }

  let contentType = '';
  let content = '';
  if (includeBody) {
    const bodyNode = item.body;
    if (bodyNode && typeof bodyNode === 'object') {
      const bodyRecord = bodyNode as Record<string, unknown>;
      contentType = asText(bodyRecord.contentType).trim().toLowerCase();
      content = asText(bodyRecord.content).trim();
    }
  }

  return {
    id: asText(item.id).trim(),
    subject: asText(item.subject).trim(),
    from: formatMailboxDisplay(senderName, senderAddress),
    receivedAt: asText(item.receivedDateTime).trim(),
    preview: asText(item.bodyPreview).trim(),
    contentType,
    content,
    folderKind,
    folderLabel: getFolderLabel(folderKind),
    isRead: detectGraphReadState(item.isRead)
  };
}

function normalizeOutlookMailItem(
  item: Record<string, unknown>,
  includeBody: boolean,
  folderKind: 'inbox' | 'junk'
): AccountMailItem {
  const fromNode = item.From;
  let senderName = '';
  let senderAddress = '';
  if (fromNode && typeof fromNode === 'object') {
    const emailNode = (fromNode as Record<string, unknown>).EmailAddress;
    if (emailNode && typeof emailNode === 'object') {
      senderName = asText((emailNode as Record<string, unknown>).Name).trim();
      senderAddress = asText((emailNode as Record<string, unknown>).Address).trim();
    }
  }

  let contentType = '';
  let content = '';
  if (includeBody) {
    const bodyNode = item.Body;
    if (bodyNode && typeof bodyNode === 'object') {
      const bodyRecord = bodyNode as Record<string, unknown>;
      contentType = asText(bodyRecord.ContentType).trim().toLowerCase();
      content = asText(bodyRecord.Content).trim();
    }
  }

  return {
    id: asText(item.Id).trim(),
    subject: asText(item.Subject).trim(),
    from: formatMailboxDisplay(senderName, senderAddress),
    receivedAt: asText(item.DateTimeReceived).trim(),
    preview: asText(item.BodyPreview).trim(),
    contentType,
    content,
    folderKind,
    folderLabel: getFolderLabel(folderKind),
    isRead: detectOutlookReadState(item.IsRead)
  };
}

function getFolderLabel(folderKind: 'inbox' | 'junk'): string {
  return folderKind === 'junk' ? '垃圾邮件' : '收件箱';
}

function extractMicrosoftError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const asRecord = payload as Record<string, unknown>;
    const direct = asText(asRecord.error_description || asRecord.error).trim();
    if (direct) {
      return `请求失败(${status}): ${direct}`;
    }

    const nested = asRecord.error;
    if (nested && typeof nested === 'object') {
      const nestedRecord = nested as Record<string, unknown>;
      const message = asText(nestedRecord.message).trim();
      if (message) {
        return `请求失败(${status}): ${message}`;
      }
    }
  }

  return `请求失败(${status})`;
}

async function updateSyncStatus(
  db: D1Database,
  accountId: number,
  params: {
    status: string;
    message: string;
    touchRefresh: boolean;
    touchFetch: boolean;
    fetchedCount: number;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE accounts
       SET
         sync_status = ?,
         sync_message = ?,
         refreshed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE refreshed_at END,
         fetched_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE fetched_at END,
         fetched_count = ?
       WHERE id = ?`
    )
    .bind(
      params.status,
      truncate(params.message, 600),
      params.touchRefresh ? 1 : 0,
      params.touchFetch ? 1 : 0,
      params.fetchedCount,
      accountId
    )
    .run();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const size = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        break;
      }

      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function parseIncomingPayload(input: unknown, config: IngestConfig): ParseIncomingResult {
  const records: ParsedAccount[] = [];
  const errors: ParseErrorItem[] = [];

  const pushError = (line: number, raw: unknown, reason: string): void => {
    errors.push({
      line,
      raw: truncate(asText(raw), 240),
      reason
    });
  };

  const handleCaptchaText = (text: string, lineStart: number): void => {
    const lines = text.split(/\r?\n/);
    let offset = 0;
    for (const sourceLine of lines) {
      const raw = sourceLine.trim();
      if (!raw) {
        offset += 1;
        continue;
      }

      try {
        const payload = parseCaptchaLine(raw, config.delimiter);
        records.push({ line: lineStart + offset, raw, payload });
      } catch (error) {
        pushError(lineStart + offset, raw, error instanceof Error ? error.message : '格式错误');
      }

      offset += 1;
    }
  };

  const handleObject = (obj: Record<string, unknown>, line: number): void => {
    const captchaNode = obj[config.captchaField];
    if (typeof captchaNode === 'string') {
      handleCaptchaText(captchaNode, line);
      return;
    }

    if (Array.isArray(captchaNode)) {
      captchaNode.forEach((item, index) => {
        consume(item, line + index);
      });
      return;
    }

    const mappedHasAccount = hasOwnKey(obj, config.accountField);
    const mappedHasPassword = hasOwnKey(obj, config.passwordField);
    if (mappedHasAccount || mappedHasPassword) {
      const account = asText(obj[config.accountField]).trim();
      const password = asText(obj[config.passwordField]).trim();
      if (!account || !password) {
        pushError(line, safeStringify(obj), `字段 ${config.accountField} 和 ${config.passwordField} 不能为空`);
        return;
      }

      records.push({
        line,
        raw: safeStringify(obj),
        payload: {
          account,
          password,
          clientId: asText(obj[config.clientIdField]).trim(),
          refreshToken: asText(obj[config.tokenField]).trim(),
          remark: ''
        }
      });
      return;
    }

    const plainHasAccount = hasOwnKey(obj, 'account');
    const plainHasPassword = hasOwnKey(obj, 'password');
    if (plainHasAccount || plainHasPassword) {
      const account = asText(obj.account).trim();
      const password = asText(obj.password).trim();
      if (!account || !password) {
        pushError(line, safeStringify(obj), '字段 account 和 password 不能为空');
        return;
      }

      records.push({
        line,
        raw: safeStringify(obj),
        payload: {
          account,
          password,
          clientId: asText(obj.clientId ?? obj.client_id).trim(),
          refreshToken: asText(obj.refreshToken ?? obj.refresh_token).trim(),
          remark: asText(obj.remark).trim()
        }
      });
      return;
    }

    const nestedList = obj.items ?? obj.list ?? null;
    if (Array.isArray(nestedList)) {
      nestedList.forEach((item, index) => {
        consume(item, line + index);
      });
      return;
    }

    pushError(line, safeStringify(obj), '无法识别的上传数据格式');
  };

  const consume = (node: unknown, line: number): void => {
    if (typeof node === 'string') {
      handleCaptchaText(node, line);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        consume(item, line + index);
      });
      return;
    }

    if (!node || typeof node !== 'object') {
      pushError(line, safeStringify(node), '上传内容必须是字符串、对象或数组');
      return;
    }

    handleObject(node as Record<string, unknown>, line);
  };

  consume(input, 1);
  return { records, errors };
}

function hasOwnKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return asText(value);
  }
}

function truncate(input: string, limit: number): string {
  if (input.length <= limit) {
    return input;
  }
  return `${input.slice(0, limit)}...`;
}

function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === '/api/health' ||
    pathname === '/api/auth/login' ||
    pathname === INGEST_PATH ||
    pathname === OPEN_MESSAGES_PATH ||
    pathname === '/api/open/accounts' ||
    /^\/api\/open\/accounts\/\d+\/messages$/.test(pathname) ||
    /^\/api\/open\/accounts\/\d+\/remark$/.test(pathname) ||
    /^\/api\/open\/accounts\/\d+$/.test(pathname)
  );
}

async function authenticateRequest(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const secret = getSessionSecret(c.env);
  const session = await verifySessionToken(token, secret);
  if (!session) {
    return null;
  }

  return session.username;
}

function getConfiguredUsername(env: Bindings): string {
  return asText(env.ADMIN_USERNAME).trim() || 'admin';
}

function getConfiguredPassword(env: Bindings): string {
  const password = asText(env.ADMIN_PASSWORD);
  if (!password) {
    throw new HTTPException(500, {
      message: '服务端未配置 ADMIN_PASSWORD 环境变量'
    });
  }
  return password;
}

function getSessionSecret(env: Bindings): string {
  const secret = asText(env.SESSION_SECRET);
  if (!secret) {
    throw new HTTPException(500, {
      message: '服务端未配置 SESSION_SECRET 环境变量'
    });
  }
  return secret;
}

function getIngestToken(env: Bindings): string {
  const token = asText(env.INGEST_TOKEN);
  if (!token) {
    throw new HTTPException(500, {
      message: '服务端未配置 INGEST_TOKEN 环境变量'
    });
  }
  return token;
}

function getMailApiToken(env: Bindings): string {
  const token = asText(env.MAIL_API_TOKEN || env.INGEST_TOKEN).trim();
  if (!token) {
    throw new HTTPException(500, {
      message: '服务端未配置 MAIL_API_TOKEN（或可复用 INGEST_TOKEN）环境变量'
    });
  }
  return token;
}

function readIngestToken(c: Context<{ Bindings: Bindings; Variables: Variables }>): string {
  const headerToken = asText(c.req.header(INGEST_TOKEN_HEADER)).trim();
  if (headerToken) {
    return headerToken;
  }

  const authHeader = asText(c.req.header('authorization')).trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return asText(c.req.query('token')).trim();
}

function readOpenApiToken(c: Context<{ Bindings: Bindings; Variables: Variables }>): string {
  const mailHeaderToken = asText(c.req.header(MAIL_API_TOKEN_HEADER)).trim();
  if (mailHeaderToken) {
    return mailHeaderToken;
  }

  const apiToken = asText(c.req.header('x-api-token')).trim();
  if (apiToken) {
    return apiToken;
  }

  const ingestHeaderToken = asText(c.req.header(INGEST_TOKEN_HEADER)).trim();
  if (ingestHeaderToken) {
    return ingestHeaderToken;
  }

  const authHeader = asText(c.req.header('authorization')).trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return asText(c.req.query('token')).trim();
}

function validateOpenApiToken(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  expectedToken: string
): void {
  const receivedToken = readOpenApiToken(c);
  if (!receivedToken || !timingSafeEqual(receivedToken, expectedToken)) {
    throw new HTTPException(401, { message: '开放接口令牌无效' });
  }
}

async function createSessionToken(username: string, secret: string): Promise<string> {
  const payload: SessionPayload = {
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  };

  const encodedPayload = encodeBase64UrlText(JSON.stringify(payload));
  const signature = await signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signValue(encodedPayload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: Partial<SessionPayload>;
  try {
    payload = JSON.parse(decodeBase64UrlText(encodedPayload)) as Partial<SessionPayload>;
  } catch {
    return null;
  }

  if (typeof payload.username !== 'string' || typeof payload.exp !== 'number') {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    username: payload.username,
    exp: payload.exp
  };
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return encodeBase64UrlBytes(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function encodeBase64UrlText(input: string): string {
  return encodeBase64UrlBytes(textEncoder.encode(input));
}

function decodeBase64UrlText(input: string): string {
  return textDecoder.decode(decodeBase64UrlBytes(input));
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64UrlBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = base64.length % 4;
  const padded = paddingLength === 0 ? base64 : `${base64}${'='.repeat(4 - paddingLength)}`;
  const binary = atob(padded);

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isHttpsRequest(url: string): boolean {
  return new URL(url).protocol === 'https:';
}
