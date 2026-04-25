import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  MS_TENANT_ID?: string;
  MS_REDIRECT_URI?: string;
  SEVEN79_OPEN_API_KEY?: string;
  SEVEN79_OPEN_API_USERNAME?: string;
  SEVEN79_OPEN_API_PASSWORD?: string;
  SEVEN79_OPEN_API_INVITER_CODE?: string;
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
  authType: 'manual' | 'microsoft_oauth';
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

interface StripePaymentRequest {
  checkoutInput: string;
  cardIndex: number;
  configProfile: string;
  manualToken?: string;
}

interface StripePaymentResponse {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  log: string;
  message: string;
}

interface StripePaymentProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type Seven79CardStatus = 'pending' | 'checked' | 'expired' | 'failed';

interface Seven79CardRow {
  id: number;
  cardKey: string;
  status: Seven79CardStatus;
  category: string | null;
  checkExpiryTime: string | null;
  checkRemainingTimeMs: number | null;
  cardNumber: string | null;
  expiryDate: string | null;
  cvv: string | null;
  phone: string | null;
  smsApi: string | null;
  holderName: string | null;
  address: string | null;
  cardValidUntil: string | null;
  expiresAt: string | null;
  errorMessage: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Seven79CheckResult {
  category: string | null;
  expiryTime: string | null;
  remainingTimeMs: number | null;
}

interface Seven79VerifyResult {
  cardNumber: string | null;
  expiryDate: string | null;
  cvv: string | null;
  phone: string | null;
  smsApi: string | null;
  holderName: string | null;
  address: string | null;
  expiresAt: string | null;
}

type PpSmsStatus = 'active' | 'expired' | 'failed';

interface PpSmsItemRow {
  id: number;
  fullPhone: string;
  countryCode: string | null;
  phoneNumber: string;
  smsApi: string;
  status: PpSmsStatus;
  expiresAt: string | null;
  lastCode: string | null;
  lastMessage: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PpSmsParseResult {
  fullPhone: string;
  countryCode: string | null;
  phoneNumber: string;
  smsApi: string;
}

interface PpSmsFetchResult {
  status: PpSmsStatus;
  expiresAt: string | null;
  code: string | null;
  message: string;
  raw: string;
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
  remark: string | null;
}

interface CloudMailRemarkRow {
  userId: number;
  email: string;
  remark: string | null;
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

interface Sub2ApiConfig {
  baseUrl: string;
  adminApiKey: string;
}

type Sub2ApiPlanType = 'free' | 'plus' | 'team' | '';
type Sub2ApiDetectionOutcome = 'success' | 'quota' | 'unauthorized' | 'timeout' | 'abnormal';
type Sub2ApiLogLevel = 'info' | 'success' | 'warning' | 'error';

interface Sub2ApiAccountItem {
  id: number;
  name: string;
  status: string;
  errorMessage: string | null;
  planType: Sub2ApiPlanType;
}

interface Sub2ApiDetectionSummary {
  totalAccounts: number;
  processedAccounts: number;
  availableAccounts: number;
  freeAvailableAccounts: number;
  plusAvailableAccounts: number;
  teamAvailableAccounts: number;
  quotaExhaustedAccounts: number;
  unauthorizedAccounts: number;
  abnormalAccounts: number;
}

interface Sub2ApiDetectionLogItem {
  id: string;
  timestamp: string;
  level: Sub2ApiLogLevel;
  message: string;
  accountId?: number | null;
  accountName?: string | null;
}

interface Sub2ApiDetectionProgress {
  totalAccounts: number;
  processedAccounts: number;
  currentAccountId?: number | null;
  currentAccountName?: string | null;
  outcome?: Sub2ApiDetectionOutcome;
}

interface Sub2ApiTestResult {
  outcome: Sub2ApiDetectionOutcome;
  reason: string;
  planType: Sub2ApiPlanType;
}

interface Sub2ApiDeleteAccountDetail {
  accountId: number;
  ok: boolean;
  message: string;
}

const SUB2API_ACCOUNT_TEST_TIMEOUT_MS = 45000;

interface MicrosoftOauthStatePayload {
  username: string;
  exp: number;
  mode: 'popup' | 'redirect';
}

interface SessionPayload {
  username: string;
  exp: number;
}

interface MicrosoftGraphMeResult {
  account: string;
  displayName: string | null;
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
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_MAIL_FOLDERS_URL = 'https://graph.microsoft.com/v1.0/me/mailFolders';
const OUTLOOK_MAIL_FOLDERS_URL = 'https://outlook.office.com/api/v2.0/me/mailFolders';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';
const DEFAULT_REFRESH_CONCURRENCY = 8;
const MAIL_PAGE_SIZE = 100;
const TOKEN_LIFETIME_DAYS = 90;
const MICROSOFT_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
const MICROSOFT_OAUTH_AUTHORIZE_SCOPE = 'offline_access openid profile User.Read Mail.Read';
const MICROSOFT_GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';
const MICROSOFT_OAUTH_REDIRECT_TARGET = '/services/microsoft-mail/accounts';

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

const SUB2API_CONFIG_KEY = 'sub2api_config';
const SUB2API_TEST_MODEL = 'gpt-5.4';
const SUB2API_PAGE_SIZE = 100;

const DEFAULT_SUB2API_CONFIG: Sub2ApiConfig = {
  baseUrl: '',
  adminApiKey: ''
};

const ACCOUNT_SELECT_SQL = `
  SELECT
    id,
    account,
    password,
    client_id AS clientId,
    refresh_token AS refreshToken,
    IFNULL(auth_type, 'manual') AS authType,
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

const SEVEN79_CARD_SELECT_SQL = `
  SELECT
    id,
    card_key AS cardKey,
    status,
    category,
    check_expiry_time AS checkExpiryTime,
    check_remaining_time_ms AS checkRemainingTimeMs,
    card_number AS cardNumber,
    expiry_date AS expiryDate,
    cvv,
    phone,
    sms_api AS smsApi,
    holder_name AS holderName,
    address,
    card_valid_until AS cardValidUntil,
    expires_at AS expiresAt,
    error_message AS errorMessage,
    last_checked_at AS lastCheckedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM seven79_cards
`;

const PP_SMS_ITEM_SELECT_SQL = `
  SELECT
    id,
    full_phone AS fullPhone,
    country_code AS countryCode,
    phone_number AS phoneNumber,
    sms_api AS smsApi,
    status,
    expires_at AS expiresAt,
    last_code AS lastCode,
    last_message AS lastMessage,
    last_checked_at AS lastCheckedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM pp_sms_items
`;

const SEVEN79_OPEN_API_BASE_URL = 'https://cards.779.chat';
const SEVEN79_OPEN_API_LOGIN_PATH = '/open-api/web-api/auth/login';
const SEVEN79_OPEN_API_REDEEM_PATH = '/open-api/web-api/redeem/submit';
const DEFAULT_SEVEN79_OPEN_API_KEY = 'ak_moa17dc8_n4nmv47e4ys';
const DEFAULT_SEVEN79_OPEN_API_USERNAME = 'admin123';
const DEFAULT_SEVEN79_OPEN_API_PASSWORD = 'admin123';

const DEFAULT_PAY_TIMEOUT_MS = 120000;
const PAY_OUTPUT_LIMIT = 60000;
const PAY_CONFIG_PROFILES = new Map<string, string>([['default', 'config.json']]);
const CHECKOUT_SESSION_PATTERN = /cs_(?:live|test)_[A-Za-z0-9]+/;
let stripePaymentRunning = false;

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


app.get('/auth/microsoft', async (c) => {
  const authUser = await authenticateRequest(c);
  const oauthMode = c.req.query('mode') === 'popup' ? 'popup' : 'redirect';
  if (!authUser) {
    const loginUrl = new URL('/login', c.req.url);
    loginUrl.searchParams.set('redirect', MICROSOFT_OAUTH_REDIRECT_TARGET);
    return c.redirect(loginUrl.toString(), 302);
  }

  const clientId = getMicrosoftClientId(c.env);
  const tenantId = getMicrosoftTenantId(c.env);
  const redirectUri = getMicrosoftRedirectUri(c.env);
  const state = await createMicrosoftOauthState(authUser, getSessionSecret(c.env), oauthMode);
  const authorizeUrl = buildMicrosoftAuthorizeUrl({
    clientId,
    tenantId,
    redirectUri,
    state
  });

  return c.redirect(authorizeUrl, 302);
});

app.get('/auth/microsoft/callback', async (c) => {
  const code = asText(c.req.query('code')).trim();
  const state = asText(c.req.query('state')).trim();
  const remoteError = asText(c.req.query('error')).trim();
  const remoteErrorDescription = asText(c.req.query('error_description')).trim();
  const verified = state
    ? await verifyMicrosoftOauthState(state, getSessionSecret(c.env))
    : null;

  logMicrosoftOauth('callback_received', {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    remoteError,
    verifiedUser: verified?.username,
    verifiedMode: verified?.mode
  });

  if (remoteError) {
    logMicrosoftOauth('callback_remote_error', {
      remoteError,
      remoteErrorDescription,
      verifiedUser: verified?.username,
      verifiedMode: verified?.mode
    });
    return redirectMicrosoftOauthResult(
      c,
      {
        ok: false,
        message: remoteErrorDescription || remoteError
      },
      verified
    );
  }

  if (!code || !state) {
    logMicrosoftOauth('callback_missing_code_or_state', {
      hasCode: Boolean(code),
      hasState: Boolean(state)
    });
    return redirectMicrosoftOauthResult(c, {
      ok: false,
      message: '微软授权回调缺少 code 或 state'
    });
  }

  if (!verified) {
    logMicrosoftOauth('callback_invalid_state', {});
    return redirectMicrosoftOauthResult(c, {
      ok: false,
      message: '微软授权状态已失效，请重新发起 OAuth 登录'
    });
  }

  const currentUser = await authenticateRequest(c);
  if (!currentUser || currentUser !== verified.username) {
    logMicrosoftOauth('callback_auth_mismatch', {
      currentUser,
      verifiedUser: verified.username,
      verifiedMode: verified.mode
    });
    return redirectMicrosoftOauthResult(
      c,
      {
        ok: false,
        message: '当前登录状态已失效，请重新登录后再执行 OAuth 登录'
      },
      verified
    );
  }

  const exchanged = await exchangeMicrosoftAuthorizationCode(c.env, code);
  if (!exchanged.ok) {
    logMicrosoftOauth('token_exchange_failed', {
      verifiedUser: verified.username,
      verifiedMode: verified.mode,
      error: exchanged.error
    });
    return redirectMicrosoftOauthResult(c, {
      ok: false,
      message: exchanged.error
    }, verified);
  }

  logMicrosoftOauth('token_exchange_succeeded', {
    verifiedUser: verified.username,
    verifiedMode: verified.mode,
    hasRefreshToken: Boolean(exchanged.result.refreshToken)
  });

  const me = await readMicrosoftMe(exchanged.result.accessToken);
  if (!me.ok) {
    logMicrosoftOauth('graph_me_failed', {
      verifiedUser: verified.username,
      verifiedMode: verified.mode,
      error: me.error
    });
    return redirectMicrosoftOauthResult(c, {
      ok: false,
      message: me.error
    }, verified);
  }

  logMicrosoftOauth('graph_me_succeeded', {
    verifiedUser: verified.username,
    verifiedMode: verified.mode,
    account: me.result.account
  });

  try {
    await upsertMicrosoftOauthAccount(c.env.DB, {
      account: me.result.account,
      clientId: getMicrosoftClientId(c.env),
      refreshToken: exchanged.result.refreshToken
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth 账号写入失败';
    logMicrosoftOauth('account_upsert_failed', {
      verifiedUser: verified.username,
      verifiedMode: verified.mode,
      account: me.result.account,
      error: message
    });
    return redirectMicrosoftOauthResult(c, {
      ok: false,
      message
    }, verified);
  }

  logMicrosoftOauth('callback_success', {
    verifiedUser: verified.username,
    verifiedMode: verified.mode,
    account: me.result.account
  });
  return redirectMicrosoftOauthResult(c, {
    ok: true,
    account: me.result.account
  }, verified);
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
        `INSERT INTO accounts (account, password, client_id, refresh_token, auth_type, remark)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        payload.account,
        payload.password,
        payload.clientId,
        payload.refreshToken,
        'manual',
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
         SET account = ?, password = ?, client_id = ?, refresh_token = ?, auth_type = ?, remark = ?
         WHERE id = ?`
      )
      .bind(
        payload.account,
        payload.password,
        payload.clientId,
        payload.refreshToken,
        'manual',
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
          `INSERT OR IGNORE INTO accounts (account, password, client_id, refresh_token, auth_type, remark)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          payload.account,
          payload.password,
          toNullableText(payload.clientId),
          toNullableText(payload.refreshToken),
          'manual',
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

app.get('/api/779/cards', async (c) => {
  const keyword = asText(c.req.query('keyword')).trim();
  const items = await querySeven79Cards(c.env.DB, keyword);
  return c.json({ items });
});

app.post('/api/779/cards/import', async (c) => {
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

    try {
      const result = await c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO seven79_cards (card_key, status, created_at, updated_at)
           VALUES (?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .bind(raw)
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

app.post('/api/779/cards/check', async (c) => {
  const body = await readJson<{ key?: string }>(c);
  const key = asText(body.key).trim();
  if (!key) {
    throw new HTTPException(400, { message: '卡密不能为空' });
  }

  const item = await ensureSeven79CardRefreshedByKey(c.env.DB, key);
  const latest = await fetchSeven79CardDetails(key);

  return c.json({
    item,
    check: latest.check,
    verify: latest.verify
  });
});

app.post('/api/779/cards/:id/extract', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const item = await refreshSeven79Card(c.env.DB, id);
  return c.json({ item });
});

app.post('/api/779/cards/:id/fetch-code', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const { item, code, message } = await refreshSeven79CardSmsCode(c.env.DB, id);
  return c.json({ item, code, message });
});

app.post('/api/779/cards/extract-all', async (c) => {
  const body = await readJson<{ ids?: unknown }>(c);
  const ids = Array.isArray(body.ids)
    ? body.ids.map((value) => Number.parseInt(asText(value), 10)).filter((value) => Number.isInteger(value) && value > 0)
    : [];

  const targets = ids.length > 0 ? await querySeven79CardsByIds(c.env.DB, ids) : await querySeven79Cards(c.env.DB, '');
  const items: Seven79CardRow[] = [];
  let success = 0;
  let failure = 0;

  for (const target of targets) {
    try {
      const item = await refreshSeven79Card(c.env.DB, target.id);
      items.push(item);
      success += 1;
    } catch {
      const latest = await fetchSeven79CardById(c.env.DB, target.id);
      if (latest) {
        items.push(latest);
      }
      failure += 1;
    }
  }

  return c.json({
    total: targets.length,
    success,
    failure,
    items
  });
});

app.delete('/api/779/cards/:id', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM seven79_cards WHERE id = ?').bind(id).run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: '卡密记录不存在' });
  }

  return c.json({ ok: true as const });
});

app.get('/api/779/pp-sms', async (c) => {
  const items = await queryPpSmsItems(c.env.DB);
  return c.json({ items });
});

app.post('/api/779/pp-sms/import', async (c) => {
  const body = await readJson<{ text?: string }>(c);
  const text = asText(body.text).trim();
  if (!text) {
    throw new HTTPException(400, { message: '导入内容不能为空' });
  }

  const lines = text.split(/\r?\n/);
  let inserted = 0;
  let skipped = 0;
  const errors: ParseErrorItem[] = [];
  const touchedIds: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) {
      continue;
    }

    try {
      const parsed = parsePpSmsImportLine(raw);
      const existing = await c.env.DB
        .prepare('SELECT id FROM pp_sms_items WHERE full_phone = ? OR sms_api = ? LIMIT 1')
        .bind(parsed.fullPhone, parsed.smsApi)
        .first<{ id: number }>();

      if (existing) {
        skipped += 1;
        touchedIds.push(existing.id);
        continue;
      }

      const result = await c.env.DB
        .prepare(
          `INSERT INTO pp_sms_items (full_phone, country_code, phone_number, sms_api, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .bind(parsed.fullPhone, parsed.countryCode, parsed.phoneNumber, parsed.smsApi)
        .run();

      const newId = Number(result.meta.last_row_id ?? 0);
      if (newId > 0) {
        inserted += 1;
        touchedIds.push(newId);
        await refreshPpSmsItem(c.env.DB, newId);
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors.push({
        line: index + 1,
        raw,
        reason: getErrorMessage(error)
      });
    }
  }

  const items = touchedIds.length > 0 ? await queryPpSmsItemsByIds(c.env.DB, touchedIds) : [];
  return c.json({ inserted, skipped, errors, items });
});

app.post('/api/779/pp-sms/:id/fetch-code', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const { item, code, message } = await refreshPpSmsItem(c.env.DB, id);
  return c.json({ item, code, message });
});

app.delete('/api/779/pp-sms/:id', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM pp_sms_items WHERE id = ?').bind(id).run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: 'PP 接码记录不存在' });
  }

  return c.json({ ok: true as const });
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
    refreshAccountToken({ MS_CLIENT_SECRET: c.env.MS_CLIENT_SECRET }, c.env.DB, account)
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

  const result = await fetchAccountMessages({ MS_CLIENT_SECRET: c.env.MS_CLIENT_SECRET }, c.env.DB, account, mode, true);
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

  const result = await fetchAccountMessages({ MS_CLIENT_SECRET: c.env.MS_CLIENT_SECRET }, c.env.DB, account, mode, true);
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

  const result = await fetchAccountMessages({ MS_CLIENT_SECRET: c.env.MS_CLIENT_SECRET }, c.env.DB, account, mode, true);
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

app.post('/api/stripe-payment/run', async (c) => {
  if (stripePaymentRunning) {
    throw new HTTPException(409, { message: '已有支付任务正在执行，请稍后再试' });
  }

  const body = await readJson<Partial<StripePaymentRequest>>(c);
  const payload = normalizeStripePaymentRequest(body);
  const rootDir = process.cwd();
  const scriptPath = resolve(process.env.PAY_SCRIPT_PATH?.trim() || resolve(rootDir, 'pay.py'));
  const configPath = resolveStripePaymentConfigPath(rootDir, payload.configProfile);
  const pythonBin = process.env.PAY_PYTHON_BIN?.trim() || 'python3';
  const timeoutMs = parsePositiveInteger(process.env.PAY_TIMEOUT_MS, DEFAULT_PAY_TIMEOUT_MS);
  const args = [scriptPath, payload.checkoutInput, '--card', String(payload.cardIndex), '--config', configPath];

  if (payload.manualToken) {
    args.push('--token', payload.manualToken);
  }

  stripePaymentRunning = true;
  try {
    const processResult = await runStripePaymentProcess(pythonBin, args, rootDir, timeoutMs);
    const log = await readStripePaymentLog(rootDir);
    const ok = !processResult.timedOut && processResult.exitCode === 0;
    const message = processResult.timedOut
      ? `支付脚本执行超时 (${Math.round(timeoutMs / 1000)}s)`
      : ok
        ? '支付脚本执行完成'
        : '支付脚本执行失败';

    return c.json({
      ok,
      exitCode: processResult.exitCode,
      stdout: redactStripePaymentText(limitText(processResult.stdout)),
      stderr: redactStripePaymentText(limitText(processResult.stderr)),
      log,
      message
    } satisfies StripePaymentResponse);
  } finally {
    stripePaymentRunning = false;
  }
});

app.get('/api/sub2api/config', async (c) => {
  const item = await getSub2ApiConfig(c.env.DB);
  return c.json({ item });
});

app.put('/api/sub2api/config', async (c) => {
  const body = await readJson<Partial<Sub2ApiConfig>>(c);
  const item = normalizeSub2ApiConfig(body);
  validateSub2ApiConfig(item);
  await validateSub2ApiConnection(item);
  await setAppSetting(c.env.DB, SUB2API_CONFIG_KEY, JSON.stringify(item));
  return c.json({ item });
});

app.post('/api/sub2api/check', async (c) => {
  const config = await getSub2ApiConfig(c.env.DB);
  ensureSub2ApiConfigured(config);

  let logCounter = 0;
  let aborted = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (eventName: 'log' | 'progress' | 'summary' | 'done' | 'error', payload: unknown): void => {
        if (aborted) {
          return;
        }

        controller.enqueue(
          textEncoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };

      const emitSummary = (summary: Sub2ApiDetectionSummary): void => {
        emit('summary', { ...summary });
      };

      const emitLog = (
        level: Sub2ApiLogLevel,
        message: string,
        account?: Pick<Sub2ApiAccountItem, 'id' | 'name'>
      ): void => {
        logCounter += 1;
        const item: Sub2ApiDetectionLogItem = {
          id: `${Date.now()}-${logCounter}`,
          timestamp: new Date().toISOString(),
          level,
          message,
          accountId: account?.id ?? null,
          accountName: account?.name ?? null
        };
        emit('log', item);
      };

      const closeStream = (): void => {
        if (aborted) {
          return;
        }
        aborted = true;
        controller.close();
      };

      const run = async (): Promise<void> => {
        try {
          const summary = createDefaultSub2ApiDetectionSummary();
          emitSummary(summary);
          emit('progress', {
            totalAccounts: 0,
            processedAccounts: 0
          } as Sub2ApiDetectionProgress);

          emitLog('info', '开始拉取 Sub2API 账号列表');
          const accounts = await listAllSub2ApiAccounts(config);
          summary.totalAccounts = accounts.length;
          emitSummary(summary);
          emit('progress', {
            totalAccounts: summary.totalAccounts,
            processedAccounts: summary.processedAccounts
          } as Sub2ApiDetectionProgress);

          if (accounts.length === 0) {
            emitLog('warning', '未拉取到任何账号，请检查 Sub2API 账号列表');
            emit('done', { summary: { ...summary } });
            closeStream();
            return;
          }

          emitLog('info', `账号列表拉取完成，共 ${accounts.length} 个账号，开始逐个检测`);

          for (let index = 0; index < accounts.length; index += 1) {
            if (aborted) {
              return;
            }

            const account = accounts[index];
            emitLog('info', `[${index + 1}/${accounts.length}] 开始检测 ${account.name}`, account);

            const result = await testSub2ApiAccount(config, account, (level, message) => {
              emitLog(level, `[${account.name}] ${message}`, account);
            });

            applySub2ApiDetectionResult(summary, result);
            emitSummary(summary);
            emit('progress', {
              totalAccounts: summary.totalAccounts,
              processedAccounts: summary.processedAccounts,
              currentAccountId: account.id,
              currentAccountName: account.name,
              outcome: result.outcome
            } as Sub2ApiDetectionProgress);

            emitLog(resolveSub2ApiOutcomeLogLevel(result.outcome), formatSub2ApiResultMessage(result), account);
          }

          emitLog(
            'success',
            `检测完成：总可用 ${summary.availableAccounts}，401 ${summary.unauthorizedAccounts}，额度清空 ${summary.quotaExhaustedAccounts}，异常 ${summary.abnormalAccounts}`
          );
          emit('done', { summary: { ...summary } });
          closeStream();
        } catch (error) {
          const message = getErrorMessage(error);
          emitLog('error', message);
          emit('error', { message });
          closeStream();
        }
      };

      void run();
    },
    cancel() {
      aborted = true;
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
});

app.post('/api/sub2api/accounts/batch-delete', async (c) => {
  const config = await getSub2ApiConfig(c.env.DB);
  ensureSub2ApiConfigured(config);

  const body = await readJson<{ accountIds?: unknown }>(c);
  const accountIds = parseAccountIds(body.accountIds);

  if (accountIds.length === 0) {
    throw new HTTPException(400, { message: '请至少选择一个 401 账号' });
  }

  const details = await deleteSub2ApiAccounts(config, accountIds);
  const deleted = details.filter((item) => item.ok).length;

  return c.json({
    ok: true as const,
    total: accountIds.length,
    deleted,
    skipped: accountIds.length - deleted,
    details
  });
});

app.get('/api/cloud-mail/accounts', async (c) => {
  const config = await getCloudMailConfig(c.env.DB);
  ensureCloudMailConfigured(config);

  const page = parsePageNumber(c.req.query('page'), 1);
  const pageSize = parsePageNumber(c.req.query('pageSize'), 20, 1, 100);
  const keyword = asText(c.req.query('keyword')).trim();

  const result = await listCloudMailAccounts(c.env.DB, config, {
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
  await deleteCloudMailAccountRemarks(c.env.DB, userIds);

  return c.json({
    ok: true as const,
    total: userIds.length,
    deleted: userIds.length,
    skipped: 0
  });
});

app.patch('/api/cloud-mail/accounts/:id/remark', async (c) => {
  const config = await getCloudMailConfig(c.env.DB);
  ensureCloudMailConfigured(config);

  const userId = parseNumericId(c.req.param('id'));
  const body = await readJson<{ remark?: unknown }>(c);
  const remark = normalizeRemark(body.remark);

  const remoteList = await fetchAllCloudMailAccounts(config, '');
  const account = remoteList.find((item) => item.userId === userId) ?? null;

  if (!account) {
    throw new HTTPException(404, { message: 'Cloud Mail 邮箱不存在' });
  }

  const item = await upsertCloudMailAccountRemark(c.env.DB, account, remark);

  return c.json({
    ok: true as const,
    item
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
          `INSERT OR IGNORE INTO accounts (account, password, client_id, refresh_token, auth_type, remark)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          payload.account,
          payload.password,
          toNullableText(payload.clientId),
          toNullableText(payload.refreshToken),
          'manual',
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

function normalizeStripePaymentRequest(input: Partial<StripePaymentRequest>): StripePaymentRequest {
  const checkoutInput = asText(input.checkoutInput).trim();
  if (!checkoutInput) {
    throw new HTTPException(400, { message: 'Checkout Session 或支付链接不能为空' });
  }
  if (checkoutInput.length > 2048) {
    throw new HTTPException(400, { message: 'Checkout 输入过长' });
  }
  if (!CHECKOUT_SESSION_PATTERN.test(checkoutInput) && !isHttpUrl(checkoutInput)) {
    throw new HTTPException(400, { message: 'Checkout 输入必须包含 cs_live/cs_test 或合法 URL' });
  }

  const cardIndex = Number(input.cardIndex ?? 0);
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex > 999) {
    throw new HTTPException(400, { message: '卡索引必须是 0 到 999 的整数' });
  }

  const configProfile = asText(input.configProfile || 'default').trim() || 'default';
  if (!PAY_CONFIG_PROFILES.has(configProfile)) {
    throw new HTTPException(400, { message: '配置档案不存在' });
  }

  const manualToken = asText(input.manualToken).trim();
  if (manualToken.length > 4096) {
    throw new HTTPException(400, { message: 'hCaptcha Token 过长' });
  }

  return {
    checkoutInput,
    cardIndex,
    configProfile,
    manualToken: manualToken || undefined
  };
}

function resolveStripePaymentConfigPath(rootDir: string, profile: string): string {
  const configFile = PAY_CONFIG_PROFILES.get(profile);
  if (!configFile) {
    throw new HTTPException(400, { message: '配置档案不存在' });
  }

  const configuredDefault = process.env.PAY_CONFIG_DEFAULT_PATH?.trim();
  if (profile === 'default' && configuredDefault) {
    return resolve(configuredDefault);
  }

  return resolve(rootDir, configFile);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function runStripePaymentProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<StripePaymentProcessResult> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = limitText(stdout + chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = limitText(stderr + chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectProcess(new HTTPException(500, { message: `支付脚本启动失败: ${error.message}` }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveProcess({
        exitCode: code,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}

async function readStripePaymentLog(rootDir: string): Promise<string> {
  try {
    const content = await readFile(resolve(rootDir, 'log.txt'), 'utf8');
    return redactStripePaymentText(limitText(content));
  } catch {
    return '';
  }
}

function limitText(value: string): string {
  if (value.length <= PAY_OUTPUT_LIMIT) {
    return value;
  }

  return `${value.slice(0, PAY_OUTPUT_LIMIT)}\n...输出已截断...`;
}

function redactStripePaymentText(value: string): string {
  return value
    .replace(/(sk_live_)[A-Za-z0-9_\-]+/g, '$1[REDACTED]')
    .replace(/(sk_test_)[A-Za-z0-9_\-]+/g, '$1[REDACTED]')
    .replace(/(api[_-]?key["'\s:=]+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(token["'\s:=]+)[^\s"']{12,}/gi, '$1[REDACTED]')
    .replace(/(pass(?:word)?["'\s:=]+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/\b\d{12,19}\b/g, '[REDACTED_CARD]')
    .replace(/(\b\d{3,4}\b)(?=\s*(?:cvv|cvc|安全码))/gi, '[REDACTED_CVC]');
}

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getErrorMessage(error: unknown): string {
  if (error instanceof HTTPException) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message || '发生未知错误';
  }

  return '发生未知错误';
}

function toNullableText(value: unknown): string | null {
  const text = asText(value).trim();
  return text ? text : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

async function getSub2ApiConfig(db: D1Database): Promise<Sub2ApiConfig> {
  const value = await getAppSetting(db, SUB2API_CONFIG_KEY);

  if (!value) {
    return DEFAULT_SUB2API_CONFIG;
  }

  try {
    const parsed = JSON.parse(value) as Partial<Sub2ApiConfig>;
    return normalizeSub2ApiConfig(parsed);
  } catch {
    return DEFAULT_SUB2API_CONFIG;
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

function normalizeSub2ApiConfig(input: Partial<Sub2ApiConfig>): Sub2ApiConfig {
  return {
    baseUrl: normalizeSub2ApiBaseUrl(input.baseUrl),
    adminApiKey: asText(input.adminApiKey).trim()
  };
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

function normalizeSub2ApiBaseUrl(value: unknown): string {
  const raw = asText(value).trim();
  if (!raw) {
    return '';
  }

  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    url.search = '';
    url.hash = '';
    const pathname = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
    return `${url.origin}${pathname}`;
  } catch {
    return raw;
  }
}

function validateSub2ApiConfig(config: Sub2ApiConfig): void {
  if (!config.baseUrl || !config.adminApiKey) {
    throw new HTTPException(400, { message: '请完整填写 Sub2API 地址和管理员 API Key' });
  }

  if (config.baseUrl.length > 500) {
    throw new HTTPException(400, { message: 'Sub2API 地址长度不能超过 500 个字符' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(config.baseUrl);
  } catch {
    throw new HTTPException(400, { message: 'Sub2API 地址格式不合法' });
  }

  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new HTTPException(400, { message: 'Sub2API 地址必须以 http:// 或 https:// 开头' });
  }

  if (config.adminApiKey.length > 1024) {
    throw new HTTPException(400, { message: '管理员 API Key 长度不能超过 1024 个字符' });
  }
}

function ensureCloudMailConfigured(config: CloudMailConfig): void {
  if (!config.apiBaseUrl || !config.adminEmail || !config.adminPassword) {
    throw new HTTPException(400, { message: '请先完成 Cloud Mail 配置' });
  }
}

function ensureSub2ApiConfigured(config: Sub2ApiConfig): void {
  if (!config.baseUrl || !config.adminApiKey) {
    throw new HTTPException(400, { message: '请先完成 Sub2API 配置' });
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

function createDefaultSub2ApiDetectionSummary(): Sub2ApiDetectionSummary {
  return {
    totalAccounts: 0,
    processedAccounts: 0,
    availableAccounts: 0,
    freeAvailableAccounts: 0,
    plusAvailableAccounts: 0,
    teamAvailableAccounts: 0,
    quotaExhaustedAccounts: 0,
    unauthorizedAccounts: 0,
    abnormalAccounts: 0
  };
}

function buildSub2ApiUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | null | undefined>
): string {
  const normalizedBase = normalizeSub2ApiBaseUrl(baseUrl);
  const baseWithSlash = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
  const url = new URL(path.replace(/^\/+/, ''), baseWithSlash);

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

async function fetchSub2Api(
  config: Sub2ApiConfig,
  path: string,
  init: RequestInit = {},
  query?: Record<string, string | number | null | undefined>
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-api-key', config.adminApiKey);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    return await fetch(buildSub2ApiUrl(config.baseUrl, path, query), {
      ...init,
      headers
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new HTTPException(504, { message: 'Sub2API 请求超时，请稍后重试' });
    }
    throw new HTTPException(502, { message: 'Sub2API 服务连接失败，请检查地址' });
  }
}

async function requestSub2Api<T>(
  config: Sub2ApiConfig,
  path: string,
  init: RequestInit = {},
  query?: Record<string, string | number | null | undefined>
): Promise<T> {
  const response = await fetchSub2Api(config, path, init, query);
  const rawText = await response.text();

  if (!response.ok) {
    throw new HTTPException(response.status >= 500 ? 502 : 400, {
      message: resolveSub2ApiErrorMessage(response.status, rawText)
    });
  }

  if (!rawText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new HTTPException(502, { message: 'Sub2API 返回的数据格式不正确' });
  }
}

function resolveSub2ApiErrorMessage(status: number, rawText: string): string {
  const remoteMessage = extractSub2ApiMessage(rawText);
  if (status === 401 || status === 403) {
    return remoteMessage || 'Sub2API 管理员 API Key 无效，请检查配置';
  }

  if (status === 404) {
    return remoteMessage || 'Sub2API 接口不存在，请确认地址是否正确';
  }

  if (status >= 500) {
    return remoteMessage || 'Sub2API 服务暂时不可用，请稍后重试';
  }

  if (remoteMessage) {
    return remoteMessage;
  }

  const trimmed = rawText.trim();
  if (trimmed) {
    return truncate(trimmed, 240);
  }

  return `Sub2API 请求失败 (${status})`;
}

function extractSub2ApiMessage(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    try {
      return extractSub2ApiMessage(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  const directFields = [
    record.message,
    record.error,
    record.detail,
    record.msg,
    record.reason,
    record.statusText
  ];

  for (const field of directFields) {
    const text = asText(field).trim();
    if (text) {
      return text;
    }
  }

  if (record.data !== undefined) {
    const nested = extractSub2ApiMessage(record.data);
    if (nested) {
      return nested;
    }
  }

  return '';
}

async function validateSub2ApiConnection(config: Sub2ApiConfig): Promise<void> {
  await requestSub2Api<unknown>(config, '/api/v1/admin/accounts', {}, { page: 1, page_size: 1 });
}

async function listAllSub2ApiAccounts(config: Sub2ApiConfig): Promise<Sub2ApiAccountItem[]> {
  const collected: Sub2ApiAccountItem[] = [];
  const seenIds = new Set<number>();
  let page = 1;

  while (true) {
    const payload = await requestSub2Api<unknown>(config, '/api/v1/admin/accounts', {}, {
      page,
      page_size: SUB2API_PAGE_SIZE
    });

    const items = extractSub2ApiItems(payload);
    const normalized = items
      .map((item) => normalizeSub2ApiAccount(item))
      .filter((item): item is Sub2ApiAccountItem => item !== null);

    let appended = 0;
    for (const item of normalized) {
      if (seenIds.has(item.id)) {
        continue;
      }

      seenIds.add(item.id);
      collected.push(item);
      appended += 1;
    }

    if (items.length < SUB2API_PAGE_SIZE || appended === 0 || page >= 500) {
      break;
    }

    page += 1;
  }

  return collected;
}

async function deleteSub2ApiAccounts(
  config: Sub2ApiConfig,
  accountIds: number[]
): Promise<Sub2ApiDeleteAccountDetail[]> {
  const details: Sub2ApiDeleteAccountDetail[] = [];

  for (const accountId of accountIds) {
    details.push(await deleteSub2ApiAccount(config, accountId));
  }

  return details;
}

async function deleteSub2ApiAccount(
  config: Sub2ApiConfig,
  accountId: number
): Promise<Sub2ApiDeleteAccountDetail> {
  try {
    const response = await fetchSub2Api(config, `/api/v1/admin/accounts/${accountId}`, {
      method: 'DELETE'
    });
    const rawText = await response.text();

    if (!response.ok) {
      return {
        accountId,
        ok: false,
        message: resolveSub2ApiErrorMessage(response.status, rawText)
      };
    }

    return {
      accountId,
      ok: true,
      message: formatSub2ApiDeleteResultMessage(rawText)
    };
  } catch (error) {
    return {
      accountId,
      ok: false,
      message: getErrorMessage(error)
    };
  }
}

function formatSub2ApiDeleteResultMessage(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return '账号已删除';
  }

  try {
    const parsed = toRecord(JSON.parse(trimmed));
    const nestedMessage = asText(toRecord(parsed?.data)?.message).trim();
    if (nestedMessage) {
      return truncate(nestedMessage, 240);
    }

    const directMessage = asText(parsed?.detail ?? parsed?.message).trim();
    if (directMessage && directMessage.toLowerCase() !== 'success') {
      return truncate(directMessage, 240);
    }
  } catch {
    // Ignore invalid JSON payloads and fall back to text extraction.
  }

  const resolvedMessage = extractSub2ApiMessage(trimmed);
  if (resolvedMessage && resolvedMessage.toLowerCase() !== 'success') {
    return truncate(resolvedMessage, 240);
  }

  return '账号已删除';
}

function extractSub2ApiItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = toRecord(payload);
  if (!record) {
    return [];
  }

  const candidates = [record.items, record.list, record.accounts, record.rows, record.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (Array.isArray(record.data)) {
    return record.data;
  }

  const nested = toRecord(record.data);
  if (!nested) {
    return [];
  }

  const nestedCandidates = [nested.items, nested.list, nested.accounts, nested.rows, nested.results];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeSub2ApiAccount(value: unknown): Sub2ApiAccountItem | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const id = Number.parseInt(asText(record.id).trim(), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const credentials = toRecord(record.credentials);
  return {
    id,
    name:
      asText(record.name ?? record.account ?? record.email ?? record.username).trim() || `账号 #${id}`,
    status: asText(record.status).trim(),
    errorMessage: toNullableText(record.error_message ?? record.errorMessage ?? record.message),
    planType: normalizeSub2ApiPlanType(credentials?.chatgpt_plan_type ?? credentials?.plan_type)
  };
}

function normalizeSub2ApiPlanType(value: unknown): Sub2ApiPlanType {
  const normalized = asText(value).trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'free' || normalized.includes('free')) {
    return 'free';
  }

  if (normalized === 'plus' || normalized.includes('plus')) {
    return 'plus';
  }

  if (normalized === 'team' || normalized.includes('team')) {
    return 'team';
  }

  return '';
}

async function testSub2ApiAccount(
  config: Sub2ApiConfig,
  account: Sub2ApiAccountItem,
  onLog: (level: Sub2ApiLogLevel, message: string) => void
): Promise<Sub2ApiTestResult> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, SUB2API_ACCOUNT_TEST_TIMEOUT_MS);

  try {
    const response = await fetchSub2Api(config, `/api/v1/admin/accounts/${account.id}/test`, {
      method: 'POST',
      body: JSON.stringify({
        model_id: SUB2API_TEST_MODEL
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      const rawText = await response.text();
      const reason = resolveSub2ApiErrorMessage(response.status, rawText);
      return {
        outcome: classifySub2ApiFailure(reason),
        reason,
        planType: account.planType
      };
    }

    const result = await consumeSub2ApiTestStream(response, onLog);
    return {
      ...result,
      planType: account.planType
    };
  } catch (error) {
    if (error instanceof HTTPException && error.status === 504) {
      return {
        outcome: 'timeout',
        reason: `单账号检测超时（>${Math.floor(SUB2API_ACCOUNT_TEST_TIMEOUT_MS / 1000)} 秒）`,
        planType: account.planType
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function consumeSub2ApiTestStream(
  response: Response,
  onLog: (level: Sub2ApiLogLevel, message: string) => void
): Promise<Omit<Sub2ApiTestResult, 'planType'>> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      outcome: 'abnormal',
      reason: '检测接口没有返回可读取的数据流'
    };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let sawCompletion = false;
  let sawResponseContent = false;
  let failureReason = '';

  const handleEventPayload = (payloadText: string): void => {
    const parsed = parseSub2ApiStreamPayload(payloadText);
    if (parsed === null) {
      const line = payloadText.trim();
      if (!line) {
        return;
      }

      onLog('info', truncate(line, 240));
      if (/测试完成|test complete|completed/i.test(line)) {
        sawCompletion = true;
      }
      if (!failureReason && looksLikeSub2ApiFailure(line)) {
        failureReason = line;
      }
      return;
    }

    const eventType = asText(parsed.type).trim().toLowerCase();
    const text = resolveSub2ApiStreamMessage(parsed);

    if (eventType === 'error') {
      failureReason = text || '检测失败';
      onLog('warning', truncate(failureReason, 240));
      return;
    }

    if (
      eventType === 'test_complete' ||
      eventType === 'complete' ||
      eventType === 'success' ||
      eventType === 'finished' ||
      eventType === 'done'
    ) {
      sawCompletion = true;
    }

    if (eventType === 'response' || eventType === 'message' || eventType === 'result') {
      if (text) {
        sawResponseContent = true;
      }
    }

    if (text) {
      onLog(eventType === 'test_start' ? 'info' : 'success', truncate(text, 240));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    while (true) {
      const eventBoundary = buffer.indexOf('\n\n');
      if (eventBoundary === -1) {
        break;
      }

      const chunk = buffer.slice(0, eventBoundary);
      buffer = buffer.slice(eventBoundary + 2);
      const payloadText = extractSub2ApiEventData(chunk);
      if (payloadText) {
        handleEventPayload(payloadText);
      }

      if (failureReason || sawCompletion) {
        await reader.cancel();
        break;
      }
    }

    if (failureReason || sawCompletion) {
      break;
    }
  }

  buffer += decoder.decode();
  const tailPayload = extractSub2ApiEventData(buffer);
  if (tailPayload && !failureReason && !sawCompletion) {
    handleEventPayload(tailPayload);
  }

  if (failureReason) {
    return {
      outcome: classifySub2ApiFailure(failureReason),
      reason: truncate(failureReason.trim(), 240)
    };
  }

  if (sawCompletion || sawResponseContent) {
    return {
      outcome: 'success',
      reason: '账号可用'
    };
  }

  const fallbackReason = buffer.trim();
  if (fallbackReason) {
    return {
      outcome: classifySub2ApiFailure(fallbackReason),
      reason: truncate(fallbackReason, 240)
    };
  }

  return {
    outcome: 'abnormal',
    reason: '检测结束但没有识别到明确结果'
  };
}

function extractSub2ApiEventData(block: string): string {
  const lines = block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  if (dataLines.length > 0) {
    return dataLines.join('\n').trim();
  }

  return lines.join('\n').trim();
}

function parseSub2ApiStreamPayload(payloadText: string): Record<string, unknown> | null {
  const trimmed = payloadText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return toRecord(parsed);
  } catch {
    return null;
  }
}

function resolveSub2ApiStreamMessage(payload: Record<string, unknown>): string {
  const direct = [
    payload.message,
    payload.error,
    payload.content,
    payload.response,
    payload.result,
    payload.output
  ];

  for (const field of direct) {
    const text = asText(field).trim();
    if (text) {
      return text;
    }
  }

  if (payload.type !== undefined) {
    const normalizedType = asText(payload.type).trim().toLowerCase();
    if (normalizedType === 'test_start') {
      const model = asText(payload.model ?? payload.model_id).trim() || SUB2API_TEST_MODEL;
      return `远端测试已启动，模型 ${model}`;
    }
  }

  return '';
}

function looksLikeSub2ApiFailure(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.includes('401') ||
    normalized.includes('429') ||
    normalized.includes('unauthorized') ||
    normalized.includes('authentication failed') ||
    normalized.includes('token_invalidated') ||
    normalized.includes('quota') ||
    normalized.includes('rate limit') ||
    normalized.includes('error')
  );
}

function classifySub2ApiFailure(reason: string): Sub2ApiDetectionOutcome {
  const normalized = reason.trim().toLowerCase();

  if (
    normalized.includes('401') ||
    normalized.includes('unauthorized') ||
    normalized.includes('authentication failed') ||
    normalized.includes('token_invalidated') ||
    normalized.includes('invalid api key')
  ) {
    return 'unauthorized';
  }

  if (
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('超时')
  ) {
    return 'timeout';
  }

  if (
    normalized.includes('429') ||
    normalized.includes('quota') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('额度') ||
    normalized.includes('limit reached')
  ) {
    return 'quota';
  }

  return 'abnormal';
}

function applySub2ApiDetectionResult(
  summary: Sub2ApiDetectionSummary,
  result: Sub2ApiTestResult
): void {
  summary.processedAccounts += 1;

  if (result.outcome === 'success') {
    summary.availableAccounts += 1;

    if (result.planType === 'free') {
      summary.freeAvailableAccounts += 1;
    } else if (result.planType === 'plus') {
      summary.plusAvailableAccounts += 1;
    } else if (result.planType === 'team') {
      summary.teamAvailableAccounts += 1;
    }

    return;
  }

  if (result.outcome === 'unauthorized') {
    summary.unauthorizedAccounts += 1;
    return;
  }

  if (result.outcome === 'quota') {
    summary.quotaExhaustedAccounts += 1;
    return;
  }

  summary.abnormalAccounts += 1;
}

function resolveSub2ApiOutcomeLogLevel(outcome: Sub2ApiDetectionOutcome): Sub2ApiLogLevel {
  if (outcome === 'success') {
    return 'success';
  }

  if (outcome === 'quota') {
    return 'warning';
  }

  return 'error';
}

function formatSub2ApiResultMessage(result: Sub2ApiTestResult): string {
  if (result.outcome === 'success') {
    const planLabel = formatSub2ApiPlanLabel(result.planType);
    return planLabel ? `检测通过，套餐 ${planLabel}` : '检测通过，套餐未识别';
  }

  if (result.outcome === 'quota') {
    return `额度清空或限流：${result.reason}`;
  }

  if (result.outcome === 'unauthorized') {
    return `检测命中 401：${result.reason}`;
  }

  if (result.outcome === 'timeout') {
    return `检测超时：${result.reason}`;
  }

  return `检测异常：${result.reason}`;
}

function formatSub2ApiPlanLabel(planType: Sub2ApiPlanType): string {
  if (planType === 'free') {
    return 'Free';
  }

  if (planType === 'plus') {
    return 'Plus';
  }

  if (planType === 'team') {
    return 'Team';
  }

  return '';
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
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
    createTime: toNullableText(row.createTime ?? row.createdAt ?? row.createAt ?? row.insertTime),
    remark: null
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
  db: D1Database,
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

  const result = normalizeCloudMailListPayload(data, options.page, options.pageSize);
  const remarks = await queryCloudMailAccountRemarks(
    db,
    result.items.map((item) => item.userId)
  );

  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      remark: remarks.get(item.userId) ?? null
    }))
  };
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

function serializeSeven79CardRow(row: Seven79CardRow): Seven79CardRow {
  if (row.status === 'failed' && isSeven79ExpiredMessage(row.errorMessage || '')) {
    return {
      ...row,
      status: 'expired'
    };
  }

  return row;
}

function serializePpSmsItemRow(row: PpSmsItemRow): PpSmsItemRow {
  return row;
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

async function querySeven79Cards(db: D1Database, keyword: string): Promise<Seven79CardRow[]> {
  let statement: D1PreparedStatement;

  if (keyword) {
    const like = `%${keyword}%`;
    statement = db
      .prepare(`${SEVEN79_CARD_SELECT_SQL} WHERE card_key LIKE ? OR IFNULL(card_number, '') LIKE ? OR IFNULL(phone, '') LIKE ? ORDER BY id DESC`)
      .bind(like, like, like);
  } else {
    statement = db.prepare(`${SEVEN79_CARD_SELECT_SQL} ORDER BY id DESC`);
  }

  const result = await statement.all<Seven79CardRow>();
  return result.results.map(serializeSeven79CardRow);
}

async function querySeven79CardsByIds(db: D1Database, ids: number[]): Promise<Seven79CardRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(',');
  const result = await db
    .prepare(`${SEVEN79_CARD_SELECT_SQL} WHERE id IN (${placeholders}) ORDER BY id DESC`)
    .bind(...ids)
    .all<Seven79CardRow>();

  return result.results.map(serializeSeven79CardRow);
}

async function fetchSeven79CardById(db: D1Database, id: number): Promise<Seven79CardRow | null> {
  const row = await db.prepare(`${SEVEN79_CARD_SELECT_SQL} WHERE id = ?`).bind(id).first<Seven79CardRow>();
  return row ? serializeSeven79CardRow(row) : null;
}

async function fetchSeven79CardByKey(db: D1Database, key: string): Promise<Seven79CardRow | null> {
  const row = await db.prepare(`${SEVEN79_CARD_SELECT_SQL} WHERE card_key = ? LIMIT 1`).bind(key).first<Seven79CardRow>();
  return row ? serializeSeven79CardRow(row) : null;
}

async function ensureSeven79CardRefreshedByKey(db: D1Database, key: string): Promise<Seven79CardRow> {
  let existing = await fetchSeven79CardByKey(db, key);

  if (!existing) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO seven79_cards (card_key, status, created_at, updated_at)
         VALUES (?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(key)
      .run();

    existing = await fetchSeven79CardByKey(db, key);
  }

  if (!existing) {
    throw new HTTPException(500, { message: '卡密记录读取失败' });
  }

  return refreshSeven79Card(db, existing.id);
}

async function queryPpSmsItems(db: D1Database): Promise<PpSmsItemRow[]> {
  const result = await db.prepare(`${PP_SMS_ITEM_SELECT_SQL} ORDER BY id DESC`).all<PpSmsItemRow>();
  return result.results.map(serializePpSmsItemRow);
}

async function queryPpSmsItemsByIds(db: D1Database, ids: number[]): Promise<PpSmsItemRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(',');
  const result = await db
    .prepare(`${PP_SMS_ITEM_SELECT_SQL} WHERE id IN (${placeholders}) ORDER BY id DESC`)
    .bind(...ids)
    .all<PpSmsItemRow>();
  return result.results.map(serializePpSmsItemRow);
}

async function fetchPpSmsItemById(db: D1Database, id: number): Promise<PpSmsItemRow | null> {
  const row = await db.prepare(`${PP_SMS_ITEM_SELECT_SQL} WHERE id = ?`).bind(id).first<PpSmsItemRow>();
  return row ? serializePpSmsItemRow(row) : null;
}

async function refreshSeven79Card(db: D1Database, id: number): Promise<Seven79CardRow> {
  const existing = await fetchSeven79CardById(db, id);
  if (!existing) {
    throw new HTTPException(404, { message: '卡密记录不存在' });
  }

  try {
    const result = await fetchSeven79CardDetails(existing.cardKey);
    const cardValidUntil = resolveSeven79CardValidUntil(result.check.expiryTime);
    await db
      .prepare(
        `UPDATE seven79_cards
         SET status = ?, category = ?, check_expiry_time = ?, check_remaining_time_ms = ?, card_number = ?, expiry_date = ?, cvv = ?, phone = ?, sms_api = ?, holder_name = ?, address = ?, card_valid_until = ?, expires_at = ?, raw_check_json = ?, raw_verify_json = ?, error_message = NULL, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        'checked',
        result.check.category,
        result.check.expiryTime,
        result.check.remainingTimeMs,
        result.verify.cardNumber,
        result.verify.expiryDate,
        result.verify.cvv,
        result.verify.phone,
        result.verify.smsApi,
        result.verify.holderName,
        result.verify.address,
        cardValidUntil,
        result.verify.expiresAt,
        JSON.stringify(result.rawCheck),
        JSON.stringify(result.rawVerify),
        id
      )
      .run();
  } catch (error) {
    const message = getErrorMessage(error);
    const status = error instanceof HTTPException ? error.status : 502;
    const nextStatus: Seven79CardStatus = isSeven79ExpiredMessage(message) ? 'expired' : 'failed';
    await db
      .prepare(
        `UPDATE seven79_cards
         SET status = ?, error_message = ?, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(nextStatus, message, id)
      .run();

    throw new HTTPException(status, { message });
  }

  const latest = await fetchSeven79CardById(db, id);
  if (!latest) {
    throw new HTTPException(500, { message: '提取完成，但读取结果失败' });
  }

  return latest;
}

async function refreshPpSmsItem(db: D1Database, id: number): Promise<{
  item: PpSmsItemRow;
  code: string | null;
  message: string;
}> {
  const existing = await fetchPpSmsItemById(db, id);
  if (!existing) {
    throw new HTTPException(404, { message: 'PP 接码记录不存在' });
  }

  try {
    const result = await fetchPpSmsCode(existing.smsApi);
    await db
      .prepare(
        `UPDATE pp_sms_items
         SET status = ?, expires_at = ?, last_code = ?, last_message = ?, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(result.status, result.expiresAt, result.code, result.message, id)
      .run();

    const latest = await fetchPpSmsItemById(db, id);
    if (!latest) {
      throw new HTTPException(500, { message: 'PP 接码刷新完成，但读取结果失败' });
    }

    return {
      item: latest,
      code: result.code,
      message: result.message
    };
  } catch (error) {
    const message = getErrorMessage(error);
    await db
      .prepare(
        `UPDATE pp_sms_items
         SET status = ?, last_message = ?, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind('failed', message, id)
      .run();

    throw new HTTPException(error instanceof HTTPException ? error.status : 502, { message });
  }
}

async function refreshSeven79CardSmsCode(db: D1Database, id: number): Promise<{
  item: Seven79CardRow;
  code: string | null;
  message: string;
}> {
  const existing = await fetchSeven79CardById(db, id);
  if (!existing) {
    throw new HTTPException(404, { message: '卡密记录不存在' });
  }

  if (!existing.smsApi) {
    throw new HTTPException(400, { message: '当前卡密没有可用的接码接口' });
  }

  try {
    const result = await fetchPpSmsCode(existing.smsApi);
    await db
      .prepare(
        `UPDATE seven79_cards
         SET expires_at = COALESCE(?, expires_at), last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(result.expiresAt, id)
      .run();

    const latest = await fetchSeven79CardById(db, id);
    if (!latest) {
      throw new HTTPException(500, { message: '验证码刷新完成，但读取卡密结果失败' });
    }

    return {
      item: latest,
      code: result.code,
      message: result.message
    };
  } catch (error) {
    throw new HTTPException(error instanceof HTTPException ? error.status : 502, {
      message: getErrorMessage(error)
    });
  }
}

async function fetchSeven79CardDetails(key: string): Promise<{
  check: Seven79CheckResult;
  verify: Seven79VerifyResult;
  rawCheck: unknown;
  rawVerify: unknown;
}> {
  const auth = await loginSeven79OpenApi();
  const rawRedeem = await callSeven79Redeem(key, auth);
  const normalized = normalizeSeven79Redeem(rawRedeem);
  return {
    check: normalized.check,
    verify: normalized.verify,
    rawCheck: rawRedeem,
    rawVerify: rawRedeem
  };
}

async function loginSeven79OpenApi(): Promise<{ token: string; inviterCode: string | null }> {
  const apiKey = getSeven79OpenApiKey();
  const username = getSeven79OpenApiUsername();
  const password = getSeven79OpenApiPassword();

  let response: Response;
  try {
    response = await fetch(`${SEVEN79_OPEN_API_BASE_URL}${SEVEN79_OPEN_API_LOGIN_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ username, password })
    });
  } catch (error) {
    throw new HTTPException(502, {
      message: `779 新接口登录失败: ${error instanceof Error ? error.message : 'unknown error'}`
    });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throwSeven79RemoteError(payload, response.status, '779 新接口登录失败');
  }

  const data = asRecord(asRecord(payload).data);
  const token = toNullableText(data.token);
  if (!token) {
    throw new HTTPException(502, { message: '779 新接口登录失败: 未返回 token' });
  }

  return {
    token,
    inviterCode: getSeven79OpenApiInviterCode()
  };
}

async function callSeven79Redeem(key: string, auth: { token: string; inviterCode: string | null }): Promise<unknown> {
  const apiKey = getSeven79OpenApiKey();
  const body: Record<string, unknown> = {
    redeemCode: key,
    deviceId: buildSeven79DeviceId(key)
  };
  if (auth.inviterCode) {
    body.inviterCode = auth.inviterCode;
  }

  let response: Response;
  try {
    response = await fetch(`${SEVEN79_OPEN_API_BASE_URL}${SEVEN79_OPEN_API_REDEEM_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        Authorization: `Bearer ${auth.token}`
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new HTTPException(502, {
      message: `779 新接口兑换失败: ${error instanceof Error ? error.message : 'unknown error'}`
    });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throwSeven79RemoteError(payload, response.status, '779 新接口兑换失败');
  }

  return payload;
}

function normalizeSeven79Redeem(payload: unknown): {
  check: Seven79CheckResult;
  verify: Seven79VerifyResult;
} {
  const data = asRecord(asRecord(payload).data);
  const delivery = parseSeven79DeliveryContent(toNullableText(data.deliveryContent));
  const expiresAt = normalizeSeven79DateTime(toNullableText(data.expiresAt));

  return {
    check: {
      category: toNullableText(data.categoryName),
      expiryTime: expiresAt,
      remainingTimeMs: resolveSeven79RemainingTimeMs(expiresAt)
    },
    verify: {
      cardNumber: delivery.cardNumber,
      expiryDate: delivery.expiryDate,
      cvv: delivery.cvv,
      phone: delivery.phone,
      smsApi: delivery.smsApi,
      holderName: delivery.holderName,
      address: delivery.address,
      expiresAt
    }
  };
}

function parseSeven79DeliveryContent(value: string | null): {
  cardNumber: string | null;
  expiryDate: string | null;
  cvv: string | null;
  phone: string | null;
  smsApi: string | null;
  holderName: string | null;
  address: string | null;
} {
  const text = toNullableText(value);
  if (!text) {
    return {
      cardNumber: null,
      expiryDate: null,
      cvv: null,
      phone: null,
      smsApi: null,
      holderName: null,
      address: null
    };
  }

  const parts = text.split('----').map((part) => part.trim()).filter(Boolean);
  return {
    cardNumber: parts[0] || null,
    expiryDate: normalizeSeven79ExpiryDate(parts[1] || null),
    cvv: parts[2] || null,
    phone: parts[3] || null,
    smsApi: parts[4] || null,
    holderName: parts[5] || null,
    address: parts[6] || null
  };
}

function normalizeSeven79ExpiryDate(value: string | null): string | null {
  const text = toNullableText(value);
  if (!text) {
    return null;
  }

  const match = text.match(/^(\d{4})\/(\d{1,2})$/);
  if (!match) {
    return text;
  }

  const [, year, month] = match;
  return `${String(month).padStart(2, '0')}/${year.slice(-2)}`;
}

function resolveSeven79RemainingTimeMs(value: string | null): number | null {
  const parsed = parseSeven79DateTime(value);
  if (!parsed) {
    return null;
  }

  return Math.max(0, parsed.getTime() - Date.now());
}

function buildSeven79DeviceId(key: string): string {
  return `mam-${key.toLowerCase()}`;
}

function splitPhoneNumber(value: string): {
  fullPhone: string;
  countryCode: string | null;
  phoneNumber: string;
} {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\s+/g, '');
  if (!normalized) {
    throw new HTTPException(400, { message: '手机号不能为空' });
  }

  if (normalized.startsWith('+1') && normalized.length > 2) {
    return {
      fullPhone: normalized,
      countryCode: '+1',
      phoneNumber: normalized.slice(2)
    };
  }

  return {
    fullPhone: normalized,
    countryCode: normalized.startsWith('+') ? null : null,
    phoneNumber: normalized.startsWith('+') ? normalized.slice(1) : normalized
  };
}

async function fetchPpSmsCode(smsApi: string): Promise<PpSmsFetchResult> {
  let response: Response;
  try {
    response = await fetch(smsApi);
  } catch (error) {
    throw new HTTPException(502, {
      message: `PP 接码请求失败: ${error instanceof Error ? error.message : 'unknown error'}`
    });
  }

  const raw = (await readSmsResponseText(response)).trim();
  if (!response.ok) {
    throw new HTTPException(502, { message: raw || `PP 接码请求失败 (${response.status})` });
  }

  return parsePpSmsResponse(raw);
}

function parsePpSmsResponse(raw: string): PpSmsFetchResult {
  const normalized = normalizeSmsResponseText(raw);
  const expiresAt = extractPpSmsExpiresAt(normalized);
  const expired = normalized.includes('过期') || isExpiredAt(expiresAt);
  const parts = normalized
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  const maybeCode = extractSmsCode(parts, normalized);
  if (expired) {
    return {
      status: 'expired',
      expiresAt,
      code: maybeCode,
      message: maybeCode || '已过期',
      raw: normalized
    };
  }

  if (maybeCode) {
    return {
      status: 'active',
      expiresAt,
      code: maybeCode,
      message: maybeCode,
      raw: normalized
    };
  }

  return {
    status: 'active',
    expiresAt,
    code: null,
    message: '暂无验证码',
    raw: normalized
  };
}

function extractPpSmsExpiresAt(value: string): string | null {
  const text = toNullableText(value);
  if (!text) {
    return null;
  }

  const labelledMatch = text.match(
    /(?:到期时间|有效期|过期时间|expires?\s+at)\s*[:：]?\s*([0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2}(?:[ T][0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?)/i
  );
  if (labelledMatch?.[1]) {
    return normalizePpSmsDateTime(labelledMatch[1]);
  }

  const plainMatch = text.match(/\b([0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2}(?:[ T][0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?)\b/);
  if (plainMatch?.[1]) {
    return normalizePpSmsDateTime(plainMatch[1]);
  }

  return null;
}

function resolveSeven79CardValidUntil(expiryTime: string | null): string | null {
  const parsed = parseSeven79DateTime(expiryTime);
  if (!parsed) {
    return null;
  }

  return formatSqliteDateTime(new Date(parsed.getTime() + 5 * 60 * 60 * 1000));
}

function parsePpSmsImportLine(raw: string): PpSmsParseResult {
  const parts = raw.split('------------');
  if (parts.length < 2) {
    throw new HTTPException(400, { message: '格式不正确，应为 手机号------------接码API' });
  }

  const phone = parts[0].trim();
  const smsApi = parts.slice(1).join('------------').trim();
  if (!phone || !smsApi) {
    throw new HTTPException(400, { message: '手机号或接码 API 不能为空' });
  }

  if (!/^https?:\/\//i.test(smsApi)) {
    throw new HTTPException(400, { message: '接码 API 必须以 http:// 或 https:// 开头' });
  }

  const phoneParts = splitPhoneNumber(phone);
  return {
    fullPhone: phoneParts.fullPhone,
    countryCode: phoneParts.countryCode,
    phoneNumber: phoneParts.phoneNumber,
    smsApi
  };
}

function getSeven79OpenApiKey(): string {
  return DEFAULT_SEVEN79_OPEN_API_KEY;
}

function getSeven79OpenApiUsername(): string {
  return DEFAULT_SEVEN79_OPEN_API_USERNAME;
}

function getSeven79OpenApiPassword(): string {
  return DEFAULT_SEVEN79_OPEN_API_PASSWORD;
}

function getSeven79OpenApiInviterCode(): string | null {
  return null;
}

function normalizeSeven79DateTime(value: string | null): string | null {
  const text = toNullableText(value);
  if (!text) {
    return null;
  }

  const parsed = parseSeven79DateTime(text);
  return parsed ? formatSqliteDateTime(parsed) : text;
}

function parseSeven79DateTime(value: string | null): Date | null {
  const text = toNullableText(value);
  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp);
  }

  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSqliteDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function extractRemoteErrorMessage(payload: unknown, status: number, fallback: string): string {
  const record = asRecord(payload);
  const data = asRecord(record.data);
  return (
    toNullableText(record.message)
    || toNullableText(record.error)
    || toNullableText(data.message)
    || `${fallback} (${status})`
  );
}

function resolveSeven79BusinessError(payload: unknown): string | null {
  const record = asRecord(payload);
  const data = asRecord(record.data);
  const status = toNullableText(record.status);
  const rawMessage = toNullableText(record.message) || toNullableText(record.error) || toNullableText(data.message);
  const valid = typeof record.valid === 'boolean' ? record.valid : null;
  const code = toNullableNumber(record.code);

  if (status === 'expired' || (rawMessage && /卡密已过期|card has expired|redeem card has expired/i.test(rawMessage))) {
    return '卡密已过期';
  }

  if (valid === false) {
    return rawMessage || '卡密校验失败';
  }

  if (code !== null && code !== 0) {
    return rawMessage || '779 接口返回业务错误';
  }

  return null;
}

function throwSeven79RemoteError(payload: unknown, status: number, fallback: string): never {
  const message = resolveSeven79BusinessError(payload) || extractRemoteErrorMessage(payload, status, fallback);
  const isBusinessError = status >= 400 && status < 500;
  throw new HTTPException(isBusinessError ? 400 : 502, { message });
}

function isSeven79ExpiredMessage(message: string): boolean {
  return /卡密已过期|card has expired/i.test(message);
}


function normalizePpSmsDateTime(value: string | null): string | null {
  const parsed = parseSeven79DateTime(value);
  return parsed ? formatSqliteDateTime(parsed) : toNullableText(value);
}


function extractSmsCode(parts: string[], raw: string): string | null {
  const candidates = [raw, ...parts]
    .map((part) => stripSmsExpiryMetadata(part))
    .filter(Boolean);

  for (const candidate of candidates) {
    const code = findSmsCodeInText(candidate);
    if (code) {
      return code;
    }
  }

  return null;
}

function isExpiredAt(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const parsed = Date.parse(value.replace(' ', 'T'));
  if (Number.isNaN(parsed)) {
    return false;
  }

  return parsed <= Date.now();
}

function stripSmsExpiryMetadata(value: string): string {
  return value
    .replace(/(?:到期时间|有效期|过期时间|expires?\s+at)\s*[:：]?\s*[0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2}(?:[ T][0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?/gi, ' ')
    .replace(/\b[0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2}(?:[ T][0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?\b/g, ' ')
    .trim();
}

function normalizeSmsCodeCandidateText(value: string): string {
  return decodeBasicHtmlEntities(value)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function scoreSmsCodeCandidate(code: string, context: string): number {
  let score = 0;

  if (/your\s+chatgpt\s+code\s+is/i.test(context)) {
    score += 10;
  }
  if (/(temporary\s+verification\s+code|verification\s+code|one-time\s+passcode|passcode|security\s+code|验证码|校验码|动态码|动态验证码|短信码|短信验证码|\botp\b|\bcode\b)/i.test(context)) {
    score += 6;
  }
  if (/(openai|chatgpt|paypal)/i.test(context)) {
    score += 3;
  }
  if (/(到期时间|expires?\s+at|有效期|过期)/i.test(context)) {
    score -= 4;
  }
  if (/^\d{6}$/.test(code)) {
    score += 2;
  } else if (/^\d{4}$/.test(code)) {
    score += 1;
  }

  return score;
}

function findSmsCodeInText(value: string): string | null {
  const sanitized = normalizeSmsCodeCandidateText(value);
  const matches = [...sanitized.matchAll(/(?<!\d)(\d{4,8})(?!\d)/g)]
    .map((match) => {
      const code = match[1];
      const index = match.index ?? -1;
      const context = sanitized.slice(Math.max(0, index - 80), Math.min(sanitized.length, index + code.length + 80));
      return {
        code,
        index,
        score: /^20\d{2}$/.test(code) ? Number.NEGATIVE_INFINITY : scoreSmsCodeCandidate(code, context)
      };
    })
    .filter((match) => Number.isFinite(match.score));

  if (matches.length === 0) {
    return null;
  }

  const preferred = matches
    .filter((match) => match.score > 0)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .at(-1);
  if (preferred) {
    return preferred.code;
  }

  return matches.at(-1)?.code ?? null;
}

async function readSmsResponseText(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    return '';
  }

  const utf8Text = decodeSmsResponse(bytes, 'utf-8');
  const gbText = decodeSmsResponse(bytes, 'gb18030');
  return pickPreferredSmsResponseText(utf8Text, gbText);
}

function decodeSmsResponse(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return '';
  }
}

function pickPreferredSmsResponseText(primary: string, fallback: string): string {
  if (!fallback || fallback === primary) {
    return primary;
  }
  if (!primary) {
    return fallback;
  }

  return scoreSmsResponseText(fallback) > scoreSmsResponseText(primary) ? fallback : primary;
}

function scoreSmsResponseText(value: string): number {
  const text = normalizeSmsResponseText(value);
  if (!text) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (/(yes\||no\||paypal|验证码|到期时间|有效期|验证|手机)/i.test(text)) {
    score += 6;
  }
  score += (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  score -= (text.match(/�/g) ?? []).length * 4;
  score -= (text.match(/[ÃÂâæåçð¤¥©]/g) ?? []).length * 2;
  return score;
}

function normalizeSmsResponseText(value: string): string {
  return value.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
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

async function queryCloudMailAccountRemarks(db: D1Database, userIds: number[]): Promise<Map<number, string | null>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const placeholders = userIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT user_id AS userId, remark
       FROM cloud_mail_account_remarks
       WHERE user_id IN (${placeholders})`
    )
    .bind(...userIds)
    .all<{ userId: number; remark: string | null }>();

  return new Map((results ?? []).map((item) => [item.userId, item.remark ?? null]));
}

async function upsertCloudMailAccountRemark(
  db: D1Database,
  item: CloudMailAccountItem,
  remark: string | null
): Promise<CloudMailAccountItem> {
  await db
    .prepare(
      `INSERT INTO cloud_mail_account_remarks (user_id, email, remark, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id)
       DO UPDATE SET
         email = excluded.email,
         remark = excluded.remark,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(item.userId, item.email, remark)
    .run();

  return {
    ...item,
    remark
  };
}

async function deleteCloudMailAccountRemarks(db: D1Database, userIds: number[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  const placeholders = userIds.map(() => '?').join(',');
  await db
    .prepare(`DELETE FROM cloud_mail_account_remarks WHERE user_id IN (${placeholders})`)
    .bind(...userIds)
    .run();
}

async function fetchAllCloudMailAccounts(
  config: CloudMailConfig,
  keyword: string
): Promise<CloudMailAccountItem[]> {
  const pageSize = 100;
  let page = 1;
  const items: CloudMailAccountItem[] = [];
  let total = 0;

  do {
    const token = await getCloudMailAdminToken(config);
    const params = new URLSearchParams({
      num: String(page),
      size: String(pageSize),
      status: '-1',
      isDel: '0'
    });
    if (keyword) {
      params.set('email', keyword);
    }

    const data = await requestCloudMail<unknown>(config, `/api/user/list?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: token
      }
    });

    const result = normalizeCloudMailListPayload(data, page, pageSize);
    items.push(...result.items);
    total = result.total;
    if (result.items.length < pageSize) {
      break;
    }
    page += 1;
  } while (items.length < total);

  return items;
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

async function refreshAccountToken(
  env: Pick<Bindings, 'MS_CLIENT_SECRET'>,
  db: D1Database,
  account: AccountRow
): Promise<BatchActionDetail> {
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

  const exchanged = await exchangeMicrosoftToken(env, account.refreshToken, account.clientId);
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
  env: Pick<Bindings, 'MS_CLIENT_SECRET'>,
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
      env,
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
  env: Pick<Bindings, 'MS_CLIENT_SECRET'>,
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
  const exchanged = await exchangeMicrosoftToken(env, refreshToken, clientId, getScopeByMode(mode));
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
  env: Pick<Bindings, 'MS_CLIENT_SECRET'>,
  refreshToken: string,
  clientId: string,
  scope = ''
): Promise<{ ok: true; result: TokenExchangeResult } | { ok: false; error: string }> {
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', refreshToken);

  const clientSecret = asText(env.MS_CLIENT_SECRET).trim();
  if (clientSecret) {
    params.set('client_secret', clientSecret);
  }

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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function extractMicrosoftError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const asRecord = payload as Record<string, unknown>;
    const direct = asText(asRecord.error_description || asRecord.error).trim();
    if (direct) {
      if (direct.includes('AADSTS7000012')) {
        return `请求失败(${status}): ${direct}。这通常表示授权和换 token 使用了不同的租户入口，请确认都已切换为 common。`;
      }
      return `请求失败(${status}): ${direct}`;
    }

    const nested = asRecord.error;
    if (nested && typeof nested === 'object') {
      const nestedRecord = nested as Record<string, unknown>;
      const message = asText(nestedRecord.message).trim();
      if (message) {
        if (message.includes('AADSTS7000012')) {
          return `请求失败(${status}): ${message}。这通常表示授权和换 token 使用了不同的租户入口，请确认都已切换为 common。`;
        }
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
    pathname === '/auth/microsoft/callback' ||
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

function getMicrosoftClientId(env: Bindings): string {
  const clientId = asText(env.MS_CLIENT_ID).trim();
  if (!clientId) {
    throw new HTTPException(500, { message: '服务端未配置 MS_CLIENT_ID 环境变量' });
  }
  return clientId;
}

function getMicrosoftClientSecret(env: Bindings): string {
  const clientSecret = asText(env.MS_CLIENT_SECRET).trim();
  if (!clientSecret) {
    throw new HTTPException(500, { message: '服务端未配置 MS_CLIENT_SECRET 环境变量' });
  }
  return clientSecret;
}

function getMicrosoftTenantId(_env: Bindings): string {
  return 'common';
}

function getMicrosoftRedirectUri(env: Bindings): string {
  const redirectUri = asText(env.MS_REDIRECT_URI).trim();
  if (!redirectUri) {
    throw new HTTPException(500, { message: '服务端未配置 MS_REDIRECT_URI 环境变量' });
  }
  return redirectUri;
}

function buildMicrosoftAuthorizeUrl(params: {
  clientId: string;
  tenantId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', MICROSOFT_OAUTH_AUTHORIZE_SCOPE);
  url.searchParams.set('state', params.state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

async function createMicrosoftOauthState(
  username: string,
  secret: string,
  mode: 'popup' | 'redirect'
): Promise<string> {
  const payload: MicrosoftOauthStatePayload = {
    username,
    exp: Math.floor(Date.now() / 1000) + MICROSOFT_OAUTH_STATE_MAX_AGE_SECONDS,
    mode
  };

  const encodedPayload = encodeBase64UrlText(JSON.stringify(payload));
  const signature = await signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifyMicrosoftOauthState(token: string, secret: string): Promise<MicrosoftOauthStatePayload | null> {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signValue(encodedPayload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: Partial<MicrosoftOauthStatePayload>;
  try {
    payload = JSON.parse(decodeBase64UrlText(encodedPayload)) as Partial<MicrosoftOauthStatePayload>;
  } catch {
    return null;
  }

  if (
    typeof payload.username !== 'string'
    || typeof payload.exp !== 'number'
    || (payload.mode !== 'popup' && payload.mode !== 'redirect')
  ) {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    username: payload.username,
    exp: payload.exp,
    mode: payload.mode
  };
}

function logMicrosoftOauth(event: string, payload: Record<string, unknown>): void {
  console.log(`[microsoft-oauth] ${event}`, JSON.stringify(payload));
}

function buildMicrosoftOauthResultUrl(params: { ok: boolean; message?: string; account?: string }): string {
  const url = new URL(MICROSOFT_OAUTH_REDIRECT_TARGET, 'https://local.invalid');
  url.searchParams.set('oauth', params.ok ? 'success' : 'error');
  if (params.message) {
    url.searchParams.set('message', params.message);
  }
  if (params.account) {
    url.searchParams.set('account', params.account);
  }
  return `${url.pathname}${url.search}`;
}

function buildMicrosoftOauthPopupHtml(c: Context<{ Bindings: Bindings; Variables: Variables }>, params: {
  ok: boolean;
  message?: string;
  account?: string;
}): string {
  const payload = JSON.stringify({
    source: 'microsoft-oauth',
    ok: params.ok,
    message: params.message ?? '',
    account: params.account ?? ''
  });
  const fallbackUrl = JSON.stringify(new URL(buildMicrosoftOauthResultUrl(params), c.req.url).toString());
  const targetOrigin = JSON.stringify(new URL(c.req.url).origin);
  const title = params.ok ? 'OAuth 登录成功' : 'OAuth 登录失败';
  const detail = params.ok ? '授权结果已回传，窗口即将关闭。' : (params.message || '授权失败，请返回原页面查看。');

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <p>${escapeHtml(detail)}</p>
    <script>
      (function () {
        var payload = ${payload};
        var targetOrigin = ${targetOrigin};
        var fallbackUrl = ${fallbackUrl};
        var delivered = false;
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, targetOrigin);
            delivered = true;
          }
        } catch (error) {
        }

        setTimeout(function () {
          if (!delivered) {
            window.location.replace(fallbackUrl);
            return;
          }
          try {
            window.close();
          } catch (error) {
          }
          if (!window.closed) {
            window.location.replace(fallbackUrl);
          }
        }, 150);
      })();
    </script>
  </body>
</html>`;
}

function redirectMicrosoftOauthResult(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  params: { ok: boolean; message?: string; account?: string },
  verified?: MicrosoftOauthStatePayload | null
): Response {
  if (verified?.mode === 'popup') {
    return c.html(buildMicrosoftOauthPopupHtml(c, params));
  }

  const target = new URL(buildMicrosoftOauthResultUrl(params), c.req.url);
  return c.redirect(target.toString(), 302);
}

async function exchangeMicrosoftAuthorizationCode(
  env: Bindings,
  code: string
): Promise<{ ok: true; result: TokenExchangeResult } | { ok: false; error: string }> {
  const params = new URLSearchParams();
  params.set('client_id', getMicrosoftClientId(env));
  params.set('client_secret', getMicrosoftClientSecret(env));
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', getMicrosoftRedirectUri(env));
  params.set('scope', MICROSOFT_OAUTH_AUTHORIZE_SCOPE);

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
      error: `授权码换取令牌异常: ${error instanceof Error ? error.message : 'unknown error'}`
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
  const refreshToken = asText((payload as Record<string, unknown>).refresh_token).trim();
  if (!accessToken || !refreshToken) {
    return {
      ok: false,
      error: '授权响应缺少 access_token 或 refresh_token'
    };
  }

  return {
    ok: true,
    result: {
      accessToken,
      refreshToken
    }
  };
}

async function readMicrosoftMe(
  accessToken: string
): Promise<{ ok: true; result: MicrosoftGraphMeResult } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(MICROSOFT_GRAPH_ME_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  } catch (error) {
    return {
      ok: false,
      error: `读取微软账户信息异常: ${error instanceof Error ? error.message : 'unknown error'}`
    };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: extractMicrosoftError(payload, response.status)
    };
  }

  const account = asText((payload as Record<string, unknown>).mail).trim().toLowerCase()
    || asText((payload as Record<string, unknown>).userPrincipalName).trim().toLowerCase();
  if (!account) {
    return {
      ok: false,
      error: '微软账户信息缺少邮箱地址'
    };
  }

  return {
    ok: true,
    result: {
      account,
      displayName: toNullableText((payload as Record<string, unknown>).displayName)
    }
  };
}

async function upsertMicrosoftOauthAccount(
  db: D1Database,
  payload: { account: string; clientId: string; refreshToken: string }
): Promise<AccountRow> {
  const existing = await fetchAccountByAccount(db, payload.account);
  if (existing) {
    await db
      .prepare(
        `UPDATE accounts
         SET password = ?, client_id = ?, refresh_token = ?, auth_type = ?, token_status = ?, token_message = ?, token_checked_at = CURRENT_TIMESTAMP, refreshed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        existing.password || 'oauth',
        payload.clientId,
        payload.refreshToken,
        'microsoft_oauth',
        'valid',
        'OAuth 授权成功',
        existing.id
      )
      .run();

    const updated = await fetchAccountById(db, existing.id);
    if (!updated) {
      throw new Error('OAuth 账号更新成功，但读取结果失败');
    }
    return updated;
  }

  const result = await db
    .prepare(
      `INSERT INTO accounts (account, password, client_id, refresh_token, auth_type, remark, token_status, token_message, token_checked_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(payload.account, 'oauth', payload.clientId, payload.refreshToken, 'microsoft_oauth', null, 'valid', 'OAuth 授权成功')
    .run();

  const inserted = await db.prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`).bind(Number(result.meta.last_row_id)).first<AccountRow>();
  if (!inserted) {
    throw new Error('OAuth 账号创建成功，但读取结果失败');
  }
  return inserted;
}



function getConfiguredUsername(env: Bindings): string {
  const username = asText(env.ADMIN_USERNAME);
  if (!username) {
    throw new HTTPException(500, {
      message: '服务端未配置 ADMIN_USERNAME 环境变量'
    });
  }
  return username;
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
