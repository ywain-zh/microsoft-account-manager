import type {
  Sub2ApiAdminConfig,
  Sub2ApiReauthConfig,
  Sub2ApiReauthLogLevel,
  Sub2ApiReauthTarget
} from './sub2api-reauth.js';

export interface Sub2ApiAuthContext {
  headers: Record<string, string>;
  label: string;
}

export interface Sub2ApiOAuthDraft {
  oauthUrl: string;
  sessionId: string;
  oauthState: string;
  groupIds: number[];
  groupLabel: string;
  draftName: string;
  proxyId: number | null;
  proxyLabel: string;
}

export interface Sub2ApiOAuthCallback {
  url: string;
  code: string;
  state: string;
}

export interface Sub2ApiOAuthSubmitResult {
  accountId: number | null;
  accountName: string;
  email: string;
  message: string;
  raw: unknown;
}

export interface Sub2ApiAccountTargetContext {
  groupIds: number[];
  groupLabel: string;
  proxyId: number | null;
  proxyLabel: string;
}

export interface GenerateSub2ApiOpenAiOAuthOptions {
  sub2apiConfig: Sub2ApiAdminConfig;
  reauthConfig: Sub2ApiReauthConfig;
  auth?: Sub2ApiAuthContext;
  onLog: (level: Sub2ApiReauthLogLevel, message: string, target?: Sub2ApiReauthTarget) => void;
  target?: Sub2ApiReauthTarget;
}

export interface SubmitSub2ApiOpenAiOAuthCallbackOptions extends GenerateSub2ApiOpenAiOAuthOptions {
  draft: Sub2ApiOAuthDraft;
  callbackUrl: string;
  accountEmail: string;
}

interface Sub2ApiGroupItem {
  id: number;
  name: string;
}

interface Sub2ApiProxyItem {
  id: number;
  name: string;
  protocol: string;
  host: string;
  port: string;
  status: string;
}

const DEFAULT_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_RATE_MULTIPLIER = 1;

export async function createSub2ApiAuthContext(
  sub2apiConfig: Sub2ApiAdminConfig,
  reauthConfig: Sub2ApiReauthConfig
): Promise<Sub2ApiAuthContext> {
  if (reauthConfig.authMode === 'password') {
    if (!reauthConfig.adminEmail || !reauthConfig.adminPassword) {
      throw new Error('请先填写 Sub2API 管理员邮箱和密码');
    }

    const loginData = await requestSub2ApiJson(sub2apiConfig, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: reauthConfig.adminEmail,
        password: reauthConfig.adminPassword
      },
      secrets: [reauthConfig.adminPassword]
    });
    const token = normalizeText(readRecord(loginData)?.access_token ?? readRecord(loginData)?.accessToken);
    if (!token) {
      throw new Error('Sub2API 登录返回缺少 access_token');
    }

    return {
      label: 'password',
      headers: { Authorization: `Bearer ${token}` }
    };
  }

  if (!sub2apiConfig.adminApiKey) {
    throw new Error('请先保存 Sub2API 管理员 API Key');
  }

  return {
    label: 'admin-api-key',
    headers: { 'x-api-key': sub2apiConfig.adminApiKey }
  };
}

export async function generateSub2ApiOpenAiOAuth(options: GenerateSub2ApiOpenAiOAuthOptions): Promise<Sub2ApiOAuthDraft> {
  const auth = options.auth ?? await createSub2ApiAuthContext(options.sub2apiConfig, options.reauthConfig);
  const targetContext = await resolveSub2ApiAccountTargetContext({
    ...options,
    auth,
    logPrefix: '步骤 4'
  });

  const authRequestBody: Record<string, unknown> = {
    redirect_uri: normalizeRedirectUri()
  };
  if (targetContext.proxyId) {
    authRequestBody.proxy_id = targetContext.proxyId;
  }

  const authData = readRecord(await requestSub2ApiJson(options.sub2apiConfig, '/api/v1/admin/openai/generate-auth-url', {
    method: 'POST',
    auth,
    body: authRequestBody
  }));
  const oauthUrl = normalizeText(authData?.auth_url ?? authData?.authUrl);
  const sessionId = normalizeText(authData?.session_id ?? authData?.sessionId);
  const oauthState = normalizeText(authData?.state) || extractStateFromAuthUrl(oauthUrl);
  if (!oauthUrl || !sessionId) {
    throw new Error('Sub2API 未返回完整的 auth_url / session_id');
  }

  options.onLog('success', `步骤 4：已刷新 OAuth 登录地址：${truncate(oauthUrl, 120)}`, options.target);
  return {
    oauthUrl,
    sessionId,
    oauthState,
    groupIds: targetContext.groupIds,
    groupLabel: targetContext.groupLabel,
    draftName: buildDraftAccountName(targetContext.groupLabel.split('（#')[0]),
    proxyId: targetContext.proxyId,
    proxyLabel: targetContext.proxyLabel
  };
}

export async function resolveSub2ApiAccountTargetContext(options: GenerateSub2ApiOpenAiOAuthOptions & {
  auth?: Sub2ApiAuthContext;
  logPrefix?: string;
}): Promise<Sub2ApiAccountTargetContext> {
  const auth = options.auth ?? await createSub2ApiAuthContext(options.sub2apiConfig, options.reauthConfig);
  const logPrefix = normalizeText(options.logPrefix);
  const groups = await getGroupsByNames(options.sub2apiConfig, auth, options.reauthConfig.groupNames);
  const groupIds = groups.map((group) => group.id).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (groupIds.length === 0) {
    throw new Error('Sub2API 返回的目标分组 ID 无效');
  }

  const groupLabel = groups.map((group) => `${group.name}（#${group.id}）`).join('、');
  options.onLog('info', `${logPrefix ? `${logPrefix}：` : ''}已匹配 Sub2API 分组：${groupLabel}`, options.target);

  const proxy = options.reauthConfig.defaultProxyName
    ? await resolveSub2ApiProxy(options.sub2apiConfig, auth, options.reauthConfig.defaultProxyName)
    : null;
  const proxyId = normalizeProxyId(proxy?.id);
  const proxyLabel = proxy ? buildProxyDisplayName(proxy) : '';
  if (proxy) {
    options.onLog('info', `${logPrefix ? `${logPrefix}：` : ''}已选择 Sub2API 默认代理 ${proxyLabel}`, options.target);
  } else {
    options.onLog('info', `${logPrefix ? `${logPrefix}：` : ''}未配置 Sub2API 默认代理，本次不使用代理`, options.target);
  }

  return {
    groupIds,
    groupLabel,
    proxyId,
    proxyLabel
  };
}

export async function submitSub2ApiOpenAiOAuthCallback(
  options: SubmitSub2ApiOpenAiOAuthCallbackOptions
): Promise<Sub2ApiOAuthSubmitResult> {
  const auth = options.auth ?? await createSub2ApiAuthContext(options.sub2apiConfig, options.reauthConfig);
  const callback = parseLocalhostCallback(options.callbackUrl);
  if (options.draft.oauthState && options.draft.oauthState !== callback.state) {
    throw new Error('本次 localhost 回调中的 state 与步骤 4 生成的 state 不一致，请重新执行授权');
  }

  const exchangeBody: Record<string, unknown> = {
    session_id: options.draft.sessionId,
    code: callback.code,
    state: callback.state
  };
  if (options.draft.proxyId) {
    exchangeBody.proxy_id = options.draft.proxyId;
  }

  options.onLog('info', '步骤 6：正在通过 Sub2API 交换 OpenAI 授权码', options.target);
  const exchangeData = readRecord(await requestSub2ApiJson(options.sub2apiConfig, '/api/v1/admin/openai/exchange-code', {
    method: 'POST',
    auth,
    body: exchangeBody,
    secrets: [callback.code]
  }));
  const credentials = buildOpenAiCredentials(exchangeData);
  const extra = buildOpenAiExtra(exchangeData);
  const resolvedEmail = normalizeEmail(exchangeData?.email ?? credentials.email);
  const accountName = resolvedEmail || normalizeEmail(options.accountEmail) || options.draft.draftName;

  const createPayload: Record<string, unknown> = {
    name: accountName,
    notes: '',
    platform: 'openai',
    type: 'oauth',
    credentials,
    concurrency: DEFAULT_CONCURRENCY,
    priority: options.reauthConfig.accountPriority,
    rate_multiplier: DEFAULT_RATE_MULTIPLIER,
    group_ids: options.draft.groupIds,
    auto_pause_on_expired: options.reauthConfig.autoPauseOnExpired
  };
  if (options.draft.proxyId) {
    createPayload.proxy_id = options.draft.proxyId;
  }
  if (extra) {
    createPayload.extra = extra;
  }

  options.onLog('info', `步骤 6：授权码交换成功，正在创建或更新 Sub2API 账号（名称：${accountName}）`, options.target);
  const createdAccount = await requestSub2ApiJson(options.sub2apiConfig, '/api/v1/admin/accounts', {
    method: 'POST',
    auth,
    body: createPayload,
    secrets: Object.values(credentials)
  });
  const createdRecord = readRecord(createdAccount);
  const accountId = normalizePositiveInteger(createdRecord?.id);
  const message = `步骤 6 完成：SUB2API 回调验证通过，账号 ${accountId ? `#${accountId}` : accountName} 已创建或更新`;
  options.onLog('success', message, options.target);
  return {
    accountId,
    accountName,
    email: resolvedEmail || normalizeEmail(options.accountEmail),
    message,
    raw: createdAccount
  };
}

export function parseLocalhostCallback(rawUrl: string): Sub2ApiOAuthCallback {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('步骤 5 捕获到的 localhost OAuth 回调地址格式无效');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('步骤 5 捕获到的回调 URL 协议不正确');
  }
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('步骤 5 只接受 localhost / 127.0.0.1 回调地址');
  }
  if (parsed.pathname !== '/auth/callback' && parsed.pathname !== '/codex/callback') {
    throw new Error('步骤 5 捕获到的回调 URL 路径必须是 /auth/callback 或 /codex/callback');
  }

  const code = normalizeText(parsed.searchParams.get('code'));
  const state = normalizeText(parsed.searchParams.get('state'));
  if (!code || !state) {
    throw new Error('步骤 5 捕获到的 localhost 回调缺少 code 或 state');
  }

  return {
    url: parsed.toString(),
    code,
    state
  };
}

export async function requestSub2ApiJson(
  config: Sub2ApiAdminConfig,
  path: string,
  options: {
    method?: string;
    auth?: Sub2ApiAuthContext;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    secrets?: unknown[];
  } = {}
): Promise<unknown> {
  const headers = new Headers(options.auth?.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(config.baseUrl, path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    throw new Error('Sub2API 服务连接失败，请检查地址');
  }

  const rawText = await response.text();
  const payload = parseJsonOrNull(rawText);
  const record = readRecord(payload);
  if (record && Object.prototype.hasOwnProperty.call(record, 'code')) {
    if (Number(record.code) === 0) {
      return record.data;
    }
    throw new Error(sanitizeSensitive(extractRemoteMessage(payload) || `Sub2API 请求失败 (${response.status})`, options.secrets));
  }

  if (!response.ok) {
    throw new Error(sanitizeSensitive(extractRemoteMessage(payload) || extractRemoteMessage(rawText) || `Sub2API 请求失败 (${response.status})`, options.secrets));
  }

  return payload;
}

export function buildOpenAiCredentials(exchangeData: Record<string, unknown> | null): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  for (const key of [
    'access_token',
    'refresh_token',
    'id_token',
    'expires_at',
    'email',
    'chatgpt_account_id',
    'chatgpt_user_id',
    'organization_id',
    'plan_type',
    'client_id'
  ]) {
    const value = exchangeData?.[key];
    if (value !== undefined && value !== null && value !== '') {
      credentials[key] = value;
    }
  }

  if (!credentials.access_token) {
    throw new Error('Sub2API 交换授权码后未返回 access_token');
  }
  return credentials;
}

export function buildOpenAiExtra(exchangeData: Record<string, unknown> | null): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const key of ['email', 'name', 'privacy_mode']) {
    const value = exchangeData?.[key];
    if (value !== undefined && value !== null && value !== '') {
      extra[key] = value;
    }
  }
  return Object.keys(extra).length ? extra : undefined;
}

export function sanitizeSensitive(value: unknown, secrets: unknown = []): string {
  let text = normalizeText(value);
  const items = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of items) {
    const raw = normalizeText(secret);
    if (raw && raw.length >= 8) {
      text = text.split(raw).join('[REDACTED]');
    }
  }
  text = text.replace(/(code=)[^&\s]+/gi, '$1[REDACTED]');
  text = text.replace(/(access_token["':\s]+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
  text = text.replace(/(refresh_token["':\s]+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
  return text;
}

export function normalizeBaseUrl(value: string): string {
  const raw = normalizeText(value);
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  url.search = '';
  url.hash = '';
  const pathname = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
  return `${url.origin}${pathname}`;
}

async function getGroupsByNames(
  config: Sub2ApiAdminConfig,
  auth: Sub2ApiAuthContext,
  groupNames: string[]
): Promise<Sub2ApiGroupItem[]> {
  const targetNames = normalizeGroupNames(groupNames);
  const payload = await requestSub2ApiJson(config, '/api/v1/admin/groups/all', { method: 'GET', auth });
  const groups = Array.isArray(payload) ? payload : [];
  const matched: Sub2ApiGroupItem[] = [];
  const missing: string[] = [];

  for (const targetName of targetNames) {
    const normalized = targetName.toLowerCase();
    const group = groups.find((item) => {
      const record = readRecord(item);
      const name = normalizeText(record?.name).toLowerCase();
      const platform = normalizeText(record?.platform).toLowerCase();
      return name === normalized && (!platform || platform === 'openai');
    });

    const record = readRecord(group);
    const id = Number(record?.id);
    if (record && Number.isSafeInteger(id) && id > 0) {
      matched.push({ id, name: normalizeText(record.name) || targetName });
    } else {
      missing.push(targetName);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Sub2API 中未找到以下 openai 分组：${missing.join('、')}`);
  }

  return matched;
}

async function resolveSub2ApiProxy(
  config: Sub2ApiAdminConfig,
  auth: Sub2ApiAuthContext,
  preference: string
): Promise<Sub2ApiProxyItem | null> {
  const payload = await requestSub2ApiJson(config, '/api/v1/admin/proxies/all', {
    method: 'GET',
    auth,
    query: { with_count: 'true' }
  });
  const proxies = Array.isArray(payload) ? payload.map(normalizeProxyItem).filter((item): item is Sub2ApiProxyItem => item !== null) : [];
  const activeProxies = proxies.filter((proxy) => !proxy.status || proxy.status.toLowerCase() === 'active');
  const normalizedPreference = normalizeText(preference).toLowerCase();
  const preferredId = Number(normalizedPreference);

  if (Number.isSafeInteger(preferredId) && preferredId > 0) {
    const matched = activeProxies.find((proxy) => proxy.id === preferredId);
    if (matched) {
      return matched;
    }
    throw new Error(`Sub2API 默认代理 ID “${preference}”不存在或未启用`);
  }

  const exactMatches = activeProxies.filter((proxy) => proxy.name.toLowerCase() === normalizedPreference);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    throw new Error(`Sub2API 默认代理“${preference}”匹配到多个代理，请改填代理 ID`);
  }

  const fuzzyMatches = activeProxies.filter((proxy) => buildProxyDisplayName(proxy).toLowerCase().includes(normalizedPreference));
  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0];
  }
  if (fuzzyMatches.length > 1) {
    throw new Error(`Sub2API 默认代理“${preference}”匹配到多个代理，请改填代理 ID`);
  }

  throw new Error(`Sub2API 默认代理“${preference}”不存在或未启用`);
}

function normalizeRedirectUri(input = DEFAULT_REDIRECT_URI): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  const parsed = new URL(withProtocol);
  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = '/auth/callback';
  }
  if (parsed.pathname !== '/auth/callback') {
    throw new Error('SUB2API 回调地址必须是 /auth/callback，例如 http://localhost:1455/auth/callback');
  }
  return parsed.toString();
}

function extractStateFromAuthUrl(authUrl: string): string {
  try {
    return new URL(authUrl).searchParams.get('state') || '';
  } catch {
    return '';
  }
}

function buildDraftAccountName(groupName = 'openai-plus'): string {
  const prefix = normalizeText(groupName)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'openai-plus';
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${stamp}-${random}`;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | undefined>): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const url = new URL(path.replace(/^\/+/, ''), normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function normalizeGroupNames(value: unknown): string[] {
  const source = Array.isArray(value) ? value : normalizeText(value).split(/[\r\n,，;；]+/);
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of source) {
    const name = normalizeText(item);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(name);
  }
  return items.length ? items : ['openai-plus'];
}

function normalizeProxyItem(value: unknown): Sub2ApiProxyItem | null {
  const record = readRecord(value);
  const id = Number(record?.id);
  if (!record || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return {
    id,
    name: normalizeText(record.name),
    protocol: normalizeText(record.protocol),
    host: normalizeText(record.host),
    port: normalizeText(record.port),
    status: normalizeText(record.status)
  };
}

function buildProxyDisplayName(proxy: Sub2ApiProxyItem): string {
  const address = proxy.protocol && proxy.host && proxy.port ? `${proxy.protocol}://${proxy.host}:${proxy.port}` : '';
  return [proxy.name || '(未命名代理)', `#${proxy.id}`, address].filter(Boolean).join(' ');
}

function normalizeProxyId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function extractRemoteMessage(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const parsed = parseJsonOrNull(trimmed);
    return parsed === null ? trimmed : extractRemoteMessage(parsed);
  }

  const record = readRecord(value);
  if (!record) {
    return '';
  }

  for (const key of ['message', 'error', 'detail', 'msg', 'reason']) {
    const text = normalizeText(record[key]);
    if (text) {
      return text;
    }
  }

  return record.data === undefined ? '' : extractRemoteMessage(record.data);
}

function parseJsonOrNull(value: string): unknown | null {
  try {
    return value ? JSON.parse(value) as unknown : null;
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeEmail(value: unknown): string {
  const email = normalizeText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, Math.max(0, length - 3))}...` : value;
}
