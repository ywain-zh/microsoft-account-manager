export type Sub2ApiReauthAuthMode = 'admin-api-key' | 'password';
import {
  createSub2ApiAuthContext,
  requestSub2ApiJson,
  resolveSub2ApiAccountTargetContext,
  sanitizeSensitive,
  submitSub2ApiOpenAiOAuthCallback,
  type Sub2ApiAuthContext,
  type Sub2ApiOAuthDraft
} from './sub2api-oauth.js';

export type Sub2ApiReauthCredentialMode = 'browser-login' | 'browser-oauth' | 'session-json' | 'access-token';
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
  oauthDraft?: Sub2ApiOAuthDraft;
  oauthCallbackUrl?: string;
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

  let sessionImportContext: { groupIds: number[]; proxyId: number | null } | null = null;
  if (options.payload.credentialMode !== 'browser-oauth') {
    sessionImportContext = await prepareSessionImportContext(options, auth);
  }

  for (let index = 0; index < targets.length; index += 1) {
    if (options.isAborted?.()) {
      break;
    }

    const target = targets[index];
    const label = resolveTargetLabel(target);
    options.onLog('info', `[${index + 1}/${targets.length}] 开始处理 ${label}`, target);

    try {
      if (options.payload.credentialMode === 'browser-oauth') {
        if (dryRun) {
          summary.skippedAccounts += 1;
          options.onLog('warning', `[${label}] browser-login OAuth 模式不支持 dry-run，已跳过`, target);
          continue;
        }
        if (!options.payload.oauthDraft || !options.payload.oauthCallbackUrl) {
          throw new Error('浏览器 OAuth 模式缺少 OAuth 草稿或 localhost 回调地址');
        }

        const result = await submitSub2ApiOpenAiOAuthCallback({
          sub2apiConfig: options.sub2apiConfig,
          reauthConfig: options.reauthConfig,
          auth,
          draft: options.payload.oauthDraft,
          callbackUrl: options.payload.oauthCallbackUrl,
          accountEmail: target.accountEmail,
          onLog: options.onLog,
          target
        });

        summary.createdAccounts += result.accountId ? 1 : 0;
        summary.updatedAccounts += result.accountId ? 0 : 1;

        if (verifyAfterImport && options.verifyTarget) {
          const verifyEmail = result.email || normalizeEmail(target.accountEmail);
          options.onLog('info', `[${label}] 开始 SUB2API 回调验证后复测，模型 ${modelId}`, target);
          const verifyResult = await options.verifyTarget(target, verifyEmail, modelId);
          options.onLog(verifyResult.valid ? 'success' : 'warning', `[${label}] 复测结果：${verifyResult.message}`, target);
        }

        summary.succeededAccounts += 1;
        continue;
      }

      if (!sessionImportContext) {
        throw new Error('session 导入上下文未初始化');
      }

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
        group_ids: sessionImportContext.groupIds,
        name: parsed.authorizedEmail || normalizeEmail(target.accountEmail) || normalizeText(target.accountName),
        priority: options.reauthConfig.accountPriority,
        auto_pause_on_expired: options.reauthConfig.autoPauseOnExpired,
        update_existing: options.reauthConfig.updateExisting
      };
      if (sessionImportContext.proxyId) {
        importPayload.proxy_id = sessionImportContext.proxyId;
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

async function prepareSessionImportContext(
  options: RunSub2ApiReauthTaskOptions,
  auth: Sub2ApiAuthContext
): Promise<{ groupIds: number[]; proxyId: number | null }> {
  const context = await resolveSub2ApiAccountTargetContext({
    sub2apiConfig: options.sub2apiConfig,
    reauthConfig: options.reauthConfig,
    auth,
    onLog: options.onLog
  });
  return {
    groupIds: context.groupIds,
    proxyId: context.proxyId
  };
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message || '发生未知错误' : '发生未知错误';
}
