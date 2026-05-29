export type Sub2ApiReauthAuthMode = 'admin-api-key' | 'password';
export type Sub2ApiReauthCredentialMode = 'browser-login' | 'session-json' | 'access-token';
export type Sub2ApiReauthLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface Sub2ApiAdminConfig {
  baseUrl: string;
  adminApiKey: string;
}

export interface Sub2ApiReauthConfig {
  authMode: Sub2ApiReauthAuthMode;
  adminEmail: string;
  adminPassword: string;
  groupNames: string[];
  defaultProxyName: string;
  accountPriority: number;
  updateExisting: boolean;
  autoPauseOnExpired: boolean;
  verifyAfterImport: boolean;
  strictEmailMatch: boolean;
  allowAccessTokenOnly: boolean;
}

export interface Sub2ApiReauthTarget {
  accountId?: number;
  accountEmail: string;
  accountName?: string | null;
  reason?: string;
}

export interface Sub2ApiReauthStartPayload {
  targets: Sub2ApiReauthTarget[];
  credentialMode: Sub2ApiReauthCredentialMode;
  sessionPayload?: unknown;
  sessionPayloads?: Record<string, unknown>;
  dryRun?: boolean;
  verifyAfterImport?: boolean;
  allowAccessTokenOnly?: boolean;
  strictEmailMatch?: boolean;
  modelId?: string;
}

export interface Sub2ApiReauthProgress {
  totalAccounts: number;
  processedAccounts: number;
  currentAccountId?: number | null;
  currentAccountName?: string | null;
  outcome?: 'success' | 'skipped' | 'failed';
}

export interface Sub2ApiReauthSummary {
  totalAccounts: number;
  processedAccounts: number;
  succeededAccounts: number;
  failedAccounts: number;
  skippedAccounts: number;
  createdAccounts: number;
  updatedAccounts: number;
  importFailedAccounts: number;
  dryRun: boolean;
}

export interface Sub2ApiReauthVerifyResult {
  valid: boolean;
  message: string;
}

interface RunSub2ApiReauthTaskOptions {
  sub2apiConfig: Sub2ApiAdminConfig;
  reauthConfig: Sub2ApiReauthConfig;
  payload: Sub2ApiReauthStartPayload;
  onLog: (level: Sub2ApiReauthLogLevel, message: string, target?: Sub2ApiReauthTarget) => void;
  onProgress: (progress: Sub2ApiReauthProgress) => void;
  verifyTarget?: (target: Sub2ApiReauthTarget, email: string, modelId: string) => Promise<Sub2ApiReauthVerifyResult>;
  isAborted?: () => boolean;
}

interface Sub2ApiAuthContext {
  headers: Record<string, string>;
  label: string;
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

interface ParsedSessionInput {
  session: Record<string, unknown> | null;
  accessToken: string;
  importContent: string;
  authorizedEmail: string;
  expiresAt: number | null;
  secrets: string[];
}

interface CodexSessionImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  warnings: Array<{ message: string }>;
  errors: Array<{ message: string }>;
  items: Array<{ message?: string }>;
}

export async function runSub2ApiReauthTask(options: RunSub2ApiReauthTaskOptions): Promise<Sub2ApiReauthSummary> {
  const targets = normalizeTargets(options.payload.targets);
  const dryRun = options.payload.dryRun === true;
  const verifyAfterImport = options.payload.verifyAfterImport ?? options.reauthConfig.verifyAfterImport;
  const modelId = normalizeText(options.payload.modelId) || 'gpt-5.5';
  const summary = createDefaultSummary(targets.length, dryRun);

  options.onProgress({ totalAccounts: targets.length, processedAccounts: 0 });
  options.onLog('info', dryRun ? '开始 401 重新授权 dry-run' : '开始 401 重新授权任务');

  if (targets.length === 0) {
    options.onLog('warning', '没有需要重新授权的目标账号');
    return summary;
  }

  options.onLog('info', '正在准备 Sub2API 管理接口鉴权');
  const auth = await createSub2ApiAuthContext(options.sub2apiConfig, options.reauthConfig);
  options.onLog('info', `Sub2API 管理接口鉴权完成，模式：${auth.label}`);

  options.onLog('info', `正在查找 Sub2API 分组：${options.reauthConfig.groupNames.join('、')}`);
  const groups = await getGroupsByNames(options.sub2apiConfig, auth, options.reauthConfig.groupNames);
  const groupIds = groups.map((group) => group.id).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (groupIds.length === 0) {
    throw new Error('Sub2API 返回的目标分组 ID 无效');
  }
  options.onLog('success', `已匹配 Sub2API 分组：${groups.map((group) => `${group.name}（#${group.id}）`).join('、')}`);

  const proxy = options.reauthConfig.defaultProxyName
    ? await resolveSub2ApiProxy(options.sub2apiConfig, auth, options.reauthConfig.defaultProxyName)
    : null;
  if (proxy) {
    options.onLog('info', `已选择 Sub2API 默认代理 ${buildProxyDisplayName(proxy)}`);
  } else {
    options.onLog('info', '未配置 Sub2API 默认代理，本次导入不使用代理');
  }

  for (let index = 0; index < targets.length; index += 1) {
    if (options.isAborted?.()) {
      break;
    }

    const target = targets[index];
    const label = resolveTargetLabel(target);
    options.onLog('info', `[${index + 1}/${targets.length}] 开始处理 ${label}`, target);

    try {
      const parsed = parseTargetSessionInput(target, options.payload, options.reauthConfig);
      options.onLog('info', `[${label}] 已解析 ChatGPT ${parsed.session ? 'session JSON' : 'accessToken'}`, target);

      if (parsed.authorizedEmail) {
        options.onLog('info', `[${label}] session 授权邮箱：${parsed.authorizedEmail}`, target);
      } else {
        options.onLog('warning', `[${label}] 未能从 session 中识别授权邮箱`, target);
      }

      validateTargetEmailMatch(target, parsed, options.payload, options.reauthConfig);
      options.onLog('success', `[${label}] session 邮箱校验通过`, target);

      if (dryRun) {
        summary.skippedAccounts += 1;
        options.onLog('success', `[${label}] dry-run 通过，未调用导入接口`, target);
        continue;
      }

      const importPayload: Record<string, unknown> = {
        content: parsed.importContent,
        group_ids: groupIds,
        name: parsed.authorizedEmail || normalizeEmail(target.accountEmail) || normalizeText(target.accountName),
        priority: options.reauthConfig.accountPriority,
        auto_pause_on_expired: options.reauthConfig.autoPauseOnExpired,
        update_existing: options.reauthConfig.updateExisting
      };
      if (proxy) {
        importPayload.proxy_id = proxy.id;
      }
      if (parsed.expiresAt) {
        importPayload.expires_at = parsed.expiresAt;
      }

      options.onLog('info', `[${label}] 正在导入 ChatGPT 会话到 Sub2API`, target);
      const importResult = normalizeCodexSessionImportResult(
        await requestSub2ApiJson(options.sub2apiConfig, '/api/v1/admin/accounts/import/codex-session', {
          method: 'POST',
          auth,
          body: importPayload,
          secrets: parsed.secrets
        })
      );

      for (const warning of importResult.warnings) {
        options.onLog('warning', `[${label}] ${sanitizeSensitive(warning.message, parsed.secrets)}`, target);
      }

      summary.createdAccounts += importResult.created;
      summary.updatedAccounts += importResult.updated;
      summary.importFailedAccounts += importResult.failed;

      if (importResult.failed > 0 || importResult.created + importResult.updated <= 0) {
        throw new Error(sanitizeSensitive(getCodexSessionImportFailureMessage(importResult), parsed.secrets));
      }

      options.onLog(
        'success',
        `[${label}] Sub2API 会话导入完成：新建 ${importResult.created}，更新 ${importResult.updated}，跳过 ${importResult.skipped}，失败 ${importResult.failed}`,
        target
      );

      if (verifyAfterImport && options.verifyTarget) {
        options.onLog('info', `[${label}] 开始导入后复测，模型 ${modelId}`, target);
        const verifyResult = await options.verifyTarget(target, parsed.authorizedEmail || normalizeEmail(target.accountEmail), modelId);
        options.onLog(verifyResult.valid ? 'success' : 'warning', `[${label}] 复测结果：${verifyResult.message}`, target);
      }

      summary.succeededAccounts += 1;
    } catch (error) {
      summary.failedAccounts += 1;
      options.onLog('error', `[${label}] 重新授权失败：${getErrorMessage(error)}`, target);
    } finally {
      summary.processedAccounts += 1;
      options.onProgress({
        totalAccounts: targets.length,
        processedAccounts: summary.processedAccounts,
        currentAccountId: target.accountId ?? null,
        currentAccountName: target.accountName ?? target.accountEmail,
        outcome: summary.failedAccounts + summary.succeededAccounts + summary.skippedAccounts >= summary.processedAccounts
          ? undefined
          : undefined
      });
    }
  }

  const level: Sub2ApiReauthLogLevel = summary.failedAccounts > 0 ? 'warning' : 'success';
  options.onLog(
    level,
    `401 重新授权任务完成：成功 ${summary.succeededAccounts}，失败 ${summary.failedAccounts}，跳过 ${summary.skippedAccounts}`
  );
  return summary;
}

function createDefaultSummary(totalAccounts: number, dryRun: boolean): Sub2ApiReauthSummary {
  return {
    totalAccounts,
    processedAccounts: 0,
    succeededAccounts: 0,
    failedAccounts: 0,
    skippedAccounts: 0,
    createdAccounts: 0,
    updatedAccounts: 0,
    importFailedAccounts: 0,
    dryRun
  };
}

function normalizeTargets(value: unknown): Sub2ApiReauthTarget[] {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const targets: Sub2ApiReauthTarget[] = [];

  for (const item of items) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const accountEmail = normalizeEmail(record.accountEmail ?? record.email);
    if (!accountEmail || seen.has(accountEmail)) {
      continue;
    }

    seen.add(accountEmail);
    const accountId = Number(record.accountId ?? record.id);
    targets.push({
      accountId: Number.isSafeInteger(accountId) && accountId > 0 ? accountId : undefined,
      accountEmail,
      accountName: normalizeText(record.accountName ?? record.name) || null,
      reason: normalizeText(record.reason)
    });
  }

  return targets;
}

async function createSub2ApiAuthContext(
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

function parseTargetSessionInput(
  target: Sub2ApiReauthTarget,
  payload: Sub2ApiReauthStartPayload,
  config: Sub2ApiReauthConfig
): ParsedSessionInput {
  const rawPayload = resolveTargetSessionPayload(target, payload);
  if (payload.credentialMode === 'access-token') {
    const accessToken = normalizeText(rawPayload);
    if (!accessToken) {
      throw new Error('accessToken 不能为空');
    }
    if (!(payload.allowAccessTokenOnly ?? config.allowAccessTokenOnly)) {
      throw new Error('当前配置未允许 accessToken-only 导入，请粘贴完整 session JSON');
    }

    const authorizedEmail = resolveAuthorizedEmail(null, accessToken);
    return {
      session: null,
      accessToken,
      importContent: accessToken,
      authorizedEmail,
      expiresAt: resolveJwtExpiresAt(accessToken),
      secrets: [accessToken]
    };
  }

  const session = normalizeSessionObject(rawPayload);
  const accessToken = normalizeText(session.accessToken ?? session.access_token);
  const importContent = accessToken ? JSON.stringify({ ...session, accessToken }) : JSON.stringify(session);
  return {
    session,
    accessToken,
    importContent,
    authorizedEmail: resolveAuthorizedEmail(session, accessToken),
    expiresAt: resolveSessionExpiresAt(session) ?? resolveJwtExpiresAt(accessToken),
    secrets: [accessToken, importContent].filter(Boolean)
  };
}

function resolveTargetSessionPayload(target: Sub2ApiReauthTarget, payload: Sub2ApiReauthStartPayload): unknown {
  const byEmail = payload.sessionPayloads?.[normalizeEmail(target.accountEmail)];
  if (byEmail !== undefined) {
    return byEmail;
  }
  return payload.sessionPayload;
}

function normalizeSessionObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('session JSON 不能为空');
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return normalizeSessionObject(parsed);
    } catch {
      throw new Error('session JSON 格式不合法');
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('session JSON 必须是对象');
  }

  return value as Record<string, unknown>;
}

function validateTargetEmailMatch(
  target: Sub2ApiReauthTarget,
  parsed: ParsedSessionInput,
  payload: Sub2ApiReauthStartPayload,
  config: Sub2ApiReauthConfig
): void {
  const strictEmailMatch = payload.strictEmailMatch ?? config.strictEmailMatch;
  if (!strictEmailMatch) {
    return;
  }

  const targetEmail = normalizeEmail(target.accountEmail);
  const authorizedEmail = normalizeEmail(parsed.authorizedEmail);
  if (!authorizedEmail) {
    throw new Error('strictEmailMatch 已启用，但 session 中没有可识别邮箱');
  }
  if (targetEmail !== authorizedEmail) {
    throw new Error(`session 邮箱 ${authorizedEmail} 与目标邮箱 ${targetEmail} 不一致`);
  }
}

async function requestSub2ApiJson(
  config: Sub2ApiAdminConfig,
  path: string,
  options: {
    method?: string;
    auth?: Sub2ApiAuthContext;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    secrets?: string[];
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

function normalizeBaseUrl(value: string): string {
  const raw = normalizeText(value);
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  url.search = '';
  url.hash = '';
  const pathname = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
  return `${url.origin}${pathname}`;
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

function resolveAuthorizedEmail(session: Record<string, unknown> | null, accessToken: string): string {
  const user = readRecord(session?.user);
  const claims = parseAccessTokenClaims(accessToken || normalizeText(session?.accessToken));
  return normalizeEmail(user?.email) || normalizeEmail(session?.email) || normalizeEmail(claims?.email);
}

function resolveSessionExpiresAt(session: Record<string, unknown>): number | null {
  const raw = normalizeText(session.expires ?? session.expires_at ?? session.expiresAt);
  if (!raw) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null;
}

function resolveJwtExpiresAt(accessToken: string): number | null {
  const exp = Number(parseAccessTokenClaims(accessToken)?.exp);
  return Number.isFinite(exp) && exp > 0 ? Math.floor(exp) : null;
}

function parseAccessTokenClaims(accessToken: string): Record<string, unknown> | null {
  const token = normalizeText(accessToken);
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeCodexSessionImportResult(value: unknown): CodexSessionImportResult {
  const record = readRecord(value);
  return {
    total: normalizeCount(record?.total),
    created: normalizeCount(record?.created),
    updated: normalizeCount(record?.updated),
    skipped: normalizeCount(record?.skipped),
    failed: normalizeCount(record?.failed),
    warnings: normalizeImportMessages(record?.warnings),
    errors: normalizeImportMessages(record?.errors),
    items: Array.isArray(record?.items)
      ? record.items.map((item) => ({ message: normalizeText(readRecord(item)?.message) }))
      : []
  };
}

function normalizeImportMessages(value: unknown): Array<{ message: string }> {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({ message: normalizeText(readRecord(item)?.message ?? item) }))
    .filter((item) => item.message);
}

function getCodexSessionImportFailureMessage(result: CodexSessionImportResult): string {
  return result.errors.map((item) => item.message).find(Boolean)
    || result.warnings.map((item) => item.message).find(Boolean)
    || result.items.map((item) => normalizeText(item.message)).find(Boolean)
    || `Sub2API 会话导入失败：新建 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}，失败 ${result.failed}`;
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

function normalizeCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function resolveTargetLabel(target: Sub2ApiReauthTarget): string {
  return target.accountEmail || target.accountName || (target.accountId ? `账号 ID ${target.accountId}` : '未知账号');
}

function sanitizeSensitive(value: unknown, secrets: unknown = []): string {
  let text = normalizeText(value);
  const items = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of items) {
    const raw = normalizeText(secret);
    if (raw && raw.length >= 8) {
      text = text.split(raw).join('[REDACTED]');
    }
  }
  return text;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message || '发生未知错误' : '发生未知错误';
}
