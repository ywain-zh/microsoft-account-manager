import type {
  AccountAliasItem,
  AccountMessagesResponse,
  AccountItem,
  AccountPayload,
  AuthUser,
  BatchActionResult,
  CloudMailAccountItem,
  CloudMailAccountListResponse,
  CloudMailConfig,
  CloudMailCreatePayload,
  CloudMailMessagesResponse,
  CloudMailPublicShareInboxResponse,
  CloudMailShareResponse,
  CloudMailSyncResponse,
  ExternalApiConfig,
  IngestConfig,
  ImportResult,
  MailGptValidityService,
  MailFetchMode,
  GptPlanFilter,
  NotificationConfig,
  NotificationTestResult,
  OpenAiModelsResponse,
  PublicCheckinAccount,
  PublicCheckinAnnouncement,
  PublicCheckinAccountCredentialResponse,
  PublicCheckinAccountPayload,
  PublicCheckinBalanceResult,
  PublicCheckinBatchResult,
  PublicCheckinLogResponse,
  PublicCheckinModelProbeResponse,
  PublicCheckinSettings,
  PublicCheckinSite,
  PublicCheckinStats,
  PublicCheckinRunResult,
  Sub2ApiConfig,
  Sub2ApiDeleteAccountsResponse,
  Sub2ApiGptValidityResponse,
  Sub2ApiGroupsResponse,
  Sub2ApiImportApiKeyRequest,
  Sub2ApiImportApiKeyResponse,
  SystemBackupJobResponse,
  SystemProxyConfig,
  SystemProxyTestResult,
  TranslationConfig,
  TranslationProvider,
  TranslationResponse,
  TranslationTestResponse
} from './types';

interface ApiError {
  message?: string;
}

interface DownloadResponse {
  blob: Blob;
  filename: string;
}

export class UnauthorizedError extends Error {
  constructor(message = '未登录或登录已过期') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin'
  });

  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    const message = payload.message ?? `请求失败 (${response.status})`;
    if (response.status === 401) {
      throw new UnauthorizedError(message);
    }
    throw new Error(message);
  }

  return payload;
}

async function requestStream(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin'
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiError;
    const message = payload.message ?? `请求失败 (${response.status})`;
    if (response.status === 401) {
      throw new UnauthorizedError(message);
    }
    throw new Error(message);
  }

  return response;
}

async function requestBlob(path: string, init: RequestInit = {}): Promise<DownloadResponse> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin'
  });

  if (!response.ok) {
    const contentType = response.headers.get('Content-Type') ?? '';
    let message = `请求失败 (${response.status})`;

    if (contentType.includes('application/json')) {
      const payload = (await response.json().catch(() => ({}))) as ApiError;
      message = payload.message ?? message;
    } else {
      const text = await response.text().catch(() => '');
      message = normalizeBlobErrorMessage(text, message);
    }

    if (response.status === 401) {
      throw new UnauthorizedError(message);
    }
    throw new Error(message);
  }

  return {
    blob: await response.blob(),
    filename: parseDownloadFilename(response.headers.get('Content-Disposition')) ?? 'sub2api_gpt.json'
  };
}

function normalizeBlobErrorMessage(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }

  if (/^\s*</.test(trimmed)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(trimmed)?.[1]
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return title ? `${fallback}：${title}` : `${fallback}：服务器返回了 HTML 错误页`;
  }

  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
}

function parseDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (encodedMatch) {
    return decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/g, ''));
  }

  const plainMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return plainMatch?.[1]?.trim() || null;
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    search.set(key, String(value));
  }

  const query = search.toString();
  if (!query) {
    return '';
  }

  return `?${query}`;
}

export const api = {
  login(payload: { username: string; password: string }): Promise<{ ok: true; username: string }> {
    return request<{ ok: true; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  getMe(): Promise<AuthUser> {
    return request<AuthUser>('/api/auth/me');
  },

  logout(): Promise<{ ok: true }> {
    return request<{ ok: true }>('/api/auth/logout', {
      method: 'POST'
    });
  },

  listAccounts(keyword?: string, gptPlan?: GptPlanFilter): Promise<{ items: AccountItem[] }> {
    return request<{ items: AccountItem[] }>(`/api/accounts${buildQuery({ keyword, gptPlan })}`);
  },

  createAccount(payload: AccountPayload): Promise<{ item: AccountItem }> {
    return request<{ item: AccountItem }>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  updateAccount(id: number, payload: AccountPayload): Promise<{ item: AccountItem }> {
    return request<{ item: AccountItem }>(`/api/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  listAccountAliases(id: number): Promise<{
    accountId: number;
    account: string;
    aliases: AccountAliasItem[];
  }> {
    return request<{
      accountId: number;
      account: string;
      aliases: AccountAliasItem[];
    }>(`/api/accounts/${id}/aliases`);
  },

  createAccountAlias(id: number, aliasAccount: string): Promise<{
    accountId: number;
    account: string;
    alias: AccountAliasItem;
    aliases: AccountAliasItem[];
  }> {
    return request<{
      accountId: number;
      account: string;
      alias: AccountAliasItem;
      aliases: AccountAliasItem[];
    }>(`/api/accounts/${id}/aliases`, {
      method: 'POST',
      body: JSON.stringify({ aliasAccount })
    });
  },

  deleteAccountAlias(id: number, aliasId: number): Promise<{
    accountId: number;
    account: string;
    deletedAliasId: number;
    aliases: AccountAliasItem[];
  }> {
    return request<{
      accountId: number;
      account: string;
      deletedAliasId: number;
      aliases: AccountAliasItem[];
    }>(`/api/accounts/${id}/aliases/${aliasId}`, {
      method: 'DELETE'
    });
  },

  updateAccountPassword(id: number, password: string): Promise<{ item: AccountItem }> {
    return request<{ item: AccountItem }>(`/api/accounts/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password })
    });
  },

  deleteAccount(id: number): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/accounts/${id}`, {
      method: 'DELETE'
    });
  },

  updateAccountRemark(id: number, remark: string): Promise<{ item: AccountItem }> {
    return request<{ item: AccountItem }>(`/api/accounts/${id}/remark`, {
      method: 'PATCH',
      body: JSON.stringify({ remark })
    });
  },

  importAccounts(text: string): Promise<ImportResult> {
    return request<ImportResult>('/api/accounts/import', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
  },

  getIngestConfig(): Promise<{ item: IngestConfig; endpointPath: string; tokenHeader: string }> {
    return request<{ item: IngestConfig; endpointPath: string; tokenHeader: string }>(
      '/api/ingest-config'
    );
  },

  updateIngestConfig(payload: IngestConfig): Promise<{ item: IngestConfig }> {
    return request<{ item: IngestConfig }>('/api/ingest-config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  getExternalApiConfig(): Promise<{ item: ExternalApiConfig; tokenHeader: string }> {
    return request<{ item: ExternalApiConfig; tokenHeader: string }>('/api/external-api/config');
  },

  updateExternalApiConfig(payload: ExternalApiConfig): Promise<{ item: ExternalApiConfig }> {
    return request<{ item: ExternalApiConfig }>('/api/external-api/config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  getSystemProxyConfig(): Promise<{ item: SystemProxyConfig }> {
    return request<{ item: SystemProxyConfig }>('/api/system/proxy-config');
  },

  updateSystemProxyConfig(payload: SystemProxyConfig): Promise<{ item: SystemProxyConfig }> {
    return request<{ item: SystemProxyConfig }>('/api/system/proxy-config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  testSystemProxyConfig(payload: SystemProxyConfig): Promise<{ item: SystemProxyConfig; result: SystemProxyTestResult }> {
    return request<{ item: SystemProxyConfig; result: SystemProxyTestResult }>('/api/system/proxy-config/test', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  getNotificationConfig(): Promise<{ item: NotificationConfig }> {
    return request<{ item: NotificationConfig }>('/api/system/notification-config');
  },

  updateNotificationConfig(payload: NotificationConfig): Promise<{ item: NotificationConfig }> {
    return request<{ item: NotificationConfig }>('/api/system/notification-config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  testNotificationConfig(): Promise<NotificationTestResult> {
    return request<NotificationTestResult>('/api/system/notification-config/test', {
      method: 'POST'
    });
  },

  refreshAccounts(payload?: { accountIds?: number[] }): Promise<BatchActionResult> {
    return request<BatchActionResult>('/api/accounts/refresh', {
      method: 'POST',
      body: JSON.stringify(payload ?? {})
    });
  },

  refreshAccountsStream(payload?: { accountIds?: number[] }): Promise<Response> {
    return requestStream('/api/accounts/refresh-stream', {
      method: 'POST',
      body: JSON.stringify(payload ?? {})
    });
  },

  batchDeleteAccounts(payload: { accountIds: number[] }): Promise<{
    total: number;
    deleted: number;
    skipped: number;
  }> {
    return request<{ total: number; deleted: number; skipped: number }>('/api/accounts/batch-delete', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  getAccountMessages(id: number, mode: MailFetchMode, email?: string): Promise<AccountMessagesResponse> {
    const params = new URLSearchParams({ mode });
    if (email?.trim()) {
      params.set('email', email.trim());
    }
    return request<AccountMessagesResponse>(`/api/accounts/${id}/messages?${params.toString()}`);
  },

  markAccountMailAsRead(id: number, messageId: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/accounts/${id}/messages/read`, {
      method: 'POST',
      body: JSON.stringify({ messageId })
    });
  },

  getCloudMailConfig(): Promise<{ item: CloudMailConfig }> {
    return request<{ item: CloudMailConfig }>('/api/cloud-mail/config');
  },

  updateCloudMailConfig(payload: CloudMailConfig): Promise<{ item: CloudMailConfig }> {
    return request<{ item: CloudMailConfig }>('/api/cloud-mail/config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  getSub2ApiConfig(): Promise<{ item: Sub2ApiConfig }> {
    return request<{ item: Sub2ApiConfig }>('/api/sub2api/config');
  },

  listPublicCheckinAccounts(): Promise<PublicCheckinAccount[]> {
    return request<PublicCheckinAccount[]>('/api/public-checkin/accounts');
  },

  createPublicCheckinAccount(payload: PublicCheckinAccountPayload): Promise<PublicCheckinAccount> {
    return request<PublicCheckinAccount>('/api/public-checkin/accounts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  updatePublicCheckinAccount(id: number, payload: PublicCheckinAccountPayload): Promise<PublicCheckinAccount> {
    return request<PublicCheckinAccount>(`/api/public-checkin/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  deletePublicCheckinAccount(id: number): Promise<void> {
    return request<void>(`/api/public-checkin/accounts/${id}`, {
      method: 'DELETE'
    });
  },

  getPublicCheckinCredential(id: number): Promise<PublicCheckinAccountCredentialResponse> {
    return request<PublicCheckinAccountCredentialResponse>(`/api/public-checkin/accounts/${id}/credential`);
  },

  listPublicCheckinAnnouncements(id: number): Promise<PublicCheckinAnnouncement[]> {
    return request<PublicCheckinAnnouncement[]>(`/api/public-checkin/accounts/${id}/announcements`);
  },

  syncPublicCheckinAnnouncements(id: number): Promise<PublicCheckinAnnouncement[]> {
    return request<PublicCheckinAnnouncement[]>(`/api/public-checkin/accounts/${id}/announcements/sync`, {
      method: 'POST'
    });
  },

  markPublicCheckinAnnouncementsRead(id: number): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/public-checkin/accounts/${id}/announcements/read-all`, {
      method: 'POST'
    });
  },

  testPublicCheckinModels(id: number): Promise<PublicCheckinModelProbeResponse> {
    return request<PublicCheckinModelProbeResponse>(`/api/public-checkin/accounts/${id}/models/test`, {
      method: 'POST'
    });
  },

  testPublicCheckinAccount(id: number): Promise<PublicCheckinBalanceResult> {
    return request<PublicCheckinBalanceResult>(`/api/public-checkin/accounts/${id}/test`, {
      method: 'POST'
    });
  },

  testPublicCheckinConnection(payload: Pick<PublicCheckinAccountPayload, 'siteId' | 'site' | 'credentialType' | 'credential' | 'useProxy'>): Promise<PublicCheckinBalanceResult> {
    return request<PublicCheckinBalanceResult>('/api/public-checkin/accounts/test-connection', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  listPublicCheckinSites(): Promise<PublicCheckinSite[]> {
    return request<PublicCheckinSite[]>('/api/public-checkin/sites');
  },

  createPublicCheckinSite(payload: Pick<PublicCheckinSite, 'name' | 'url' | 'platform'>): Promise<PublicCheckinSite> {
    return request<PublicCheckinSite>('/api/public-checkin/sites', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  updatePublicCheckinSite(id: number, payload: Pick<PublicCheckinSite, 'name' | 'url' | 'platform'>): Promise<PublicCheckinSite> {
    return request<PublicCheckinSite>(`/api/public-checkin/sites/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  deletePublicCheckinSite(id: number): Promise<void> {
    return request<void>(`/api/public-checkin/sites/${id}`, {
      method: 'DELETE'
    });
  },

  runAllPublicCheckin(): Promise<PublicCheckinBatchResult[]> {
    return request<PublicCheckinBatchResult[]>('/api/public-checkin/checkin/run-all', {
      method: 'POST'
    });
  },

  runPublicCheckinAccount(id: number): Promise<PublicCheckinRunResult> {
    return request<PublicCheckinRunResult>(`/api/public-checkin/checkin/run/${id}`, {
      method: 'POST'
    });
  },

  listPublicCheckinLogs(params: {
    accountId?: number;
    status?: string;
    startAt?: number;
    endAt?: number;
    limit?: number;
    offset?: number;
  }): Promise<PublicCheckinLogResponse> {
    return request<PublicCheckinLogResponse>(`/api/public-checkin/checkin/logs${buildQuery(params)}`);
  },

  getPublicCheckinStats(): Promise<PublicCheckinStats> {
    return request<PublicCheckinStats>('/api/public-checkin/checkin/stats');
  },

  refreshAllPublicCheckinBalances(): Promise<PublicCheckinBatchResult[]> {
    return request<PublicCheckinBatchResult[]>('/api/public-checkin/balance/refresh-all', {
      method: 'POST'
    });
  },

  refreshPublicCheckinBalance(id: number): Promise<PublicCheckinBalanceResult> {
    return request<PublicCheckinBalanceResult>(`/api/public-checkin/balance/refresh/${id}`, {
      method: 'POST'
    });
  },

  getPublicCheckinSettings(): Promise<PublicCheckinSettings> {
    return request<PublicCheckinSettings>('/api/public-checkin/settings');
  },

  updatePublicCheckinSettings(payload: PublicCheckinSettings): Promise<PublicCheckinSettings> {
    return request<PublicCheckinSettings>('/api/public-checkin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  cleanupPublicCheckinLogs(): Promise<{ deleted: number }> {
    return request<{ deleted: number }>('/api/public-checkin/settings/cleanup-logs', {
      method: 'POST'
    });
  },

  updateSub2ApiConfig(payload: Sub2ApiConfig): Promise<{ item: Sub2ApiConfig }> {
    return request<{ item: Sub2ApiConfig }>('/api/sub2api/config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  listSub2ApiModels(): Promise<OpenAiModelsResponse> {
    return request<OpenAiModelsResponse>('/api/sub2api/models');
  },

  listSub2ApiGroups(): Promise<Sub2ApiGroupsResponse> {
    return request<Sub2ApiGroupsResponse>('/api/sub2api/groups');
  },

  importSub2ApiApiKeys(payload: Sub2ApiImportApiKeyRequest): Promise<Sub2ApiImportApiKeyResponse> {
    return request<Sub2ApiImportApiKeyResponse>('/api/sub2api/accounts/import-apikey', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  getTranslationConfig(): Promise<{ item: TranslationConfig }> {
    return request<{ item: TranslationConfig }>('/api/translation/config');
  },

  updateTranslationConfig(payload: TranslationConfig): Promise<{ item: TranslationConfig }> {
    return request<{ item: TranslationConfig }>('/api/translation/config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  listTranslationOpenAiModels(payload?: TranslationConfig): Promise<OpenAiModelsResponse> {
    if (payload) {
      return request<OpenAiModelsResponse>('/api/translation/openai-models', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }

    return request<OpenAiModelsResponse>('/api/translation/openai-models');
  },

  testTranslationConfig(
    payload: TranslationConfig & { provider?: TranslationProvider }
  ): Promise<TranslationTestResponse> {
    return request<TranslationTestResponse>('/api/translation/test', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  translateMailText(payload: { text: string }): Promise<TranslationResponse> {
    return request<TranslationResponse>('/api/translation/translate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  translateMailHtml(payload: { html: string; text: string }): Promise<TranslationResponse> {
    return request<TranslationResponse>('/api/translation/translate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  createSystemBackup(): Promise<SystemBackupJobResponse> {
    return request<SystemBackupJobResponse>('/api/system-backup/create', {
      method: 'POST'
    });
  },

  getSystemBackupJob(id: string): Promise<SystemBackupJobResponse> {
    return request<SystemBackupJobResponse>(`/api/system-backup/jobs/${id}`);
  },

  downloadSystemBackup(id: string): Promise<DownloadResponse> {
    return requestBlob(`/api/system-backup/jobs/${id}/download`);
  },

  cleanupSystemBackup(id: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/system-backup/jobs/${id}`, {
      method: 'DELETE'
    });
  },

  startSub2ApiCheck(payload: { modelId: string; targetGroupName: string }, signal?: AbortSignal): Promise<Response> {
    return requestStream('/api/sub2api/check', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal
    });
  },

  deleteSub2ApiAccounts(payload: { accountIds: number[] }): Promise<Sub2ApiDeleteAccountsResponse> {
    return request<Sub2ApiDeleteAccountsResponse>('/api/sub2api/accounts/batch-delete', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  exportSub2ApiGptJson(email: string): Promise<DownloadResponse> {
    return requestBlob(`/api/sub2api/accounts/gpt-json-export${buildQuery({ email })}`);
  },

  getSub2ApiGptAccessToken(email: string): Promise<{ email: string; accessToken: string }> {
    return request<{ email: string; accessToken: string }>(
      `/api/sub2api/accounts/access-token${buildQuery({ email })}`
    );
  },

  checkSub2ApiGptValidity(payload: {
    email: string;
    service: MailGptValidityService;
    modelId?: string;
  }): Promise<Sub2ApiGptValidityResponse> {
    return request<Sub2ApiGptValidityResponse>('/api/sub2api/accounts/gpt-valid-check', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  listCloudMailAccounts(payload: {
    page: number;
    pageSize: number;
    keyword?: string;
    gptPlan?: GptPlanFilter;
  }): Promise<CloudMailAccountListResponse> {
    return request<CloudMailAccountListResponse>(
      `/api/cloud-mail/accounts${buildQuery({
        page: payload.page,
        pageSize: payload.pageSize,
        keyword: payload.keyword,
        gptPlan: payload.gptPlan
      })}`
    );
  },

  syncCloudMailAccounts(): Promise<CloudMailSyncResponse> {
    return request<CloudMailSyncResponse>('/api/cloud-mail/accounts/sync', {
      method: 'POST'
    });
  },

  getCloudMailMessages(email: string): Promise<CloudMailMessagesResponse> {
    return request<CloudMailMessagesResponse>(`/api/cloud-mail/messages${buildQuery({ email })}`);
  },

  markCloudMailMessageAsRead(email: string, messageId: string): Promise<{ ok: true }> {
    return request<{ ok: true }>('/api/cloud-mail/messages/read', {
      method: 'POST',
      body: JSON.stringify({ email, messageId })
    });
  },

  getCloudMailShare(userId: number): Promise<CloudMailShareResponse> {
    return request<CloudMailShareResponse>(`/api/cloud-mail/accounts/${userId}/share`, {
      method: 'POST'
    });
  },

  regenerateCloudMailShare(userId: number): Promise<CloudMailShareResponse> {
    return request<CloudMailShareResponse>(`/api/cloud-mail/accounts/${userId}/share/regenerate`, {
      method: 'POST'
    });
  },

  revokeCloudMailShare(userId: number): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/cloud-mail/accounts/${userId}/share`, {
      method: 'DELETE'
    });
  },

  getPublicCloudMailShareInbox(token: string): Promise<CloudMailPublicShareInboxResponse> {
    return request<CloudMailPublicShareInboxResponse>(
      `/api/public/cloud-mail/shares/${encodeURIComponent(token)}`
    );
  },

  createCloudMailAccount(payload: CloudMailCreatePayload): Promise<{ ok: true; email: string }> {
    return request<{ ok: true; email: string }>('/api/cloud-mail/accounts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  deleteCloudMailAccounts(payload: { userIds: number[] }): Promise<{
    ok: true;
    total: number;
    deleted: number;
    skipped: number;
  }> {
    return request<{ ok: true; total: number; deleted: number; skipped: number }>(
      '/api/cloud-mail/accounts/batch-delete',
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  },

  updateCloudMailRemark(userId: number, remark: string): Promise<{
    ok: true;
    item: CloudMailAccountItem;
  }> {
    return request<{ ok: true; item: CloudMailAccountItem }>(`/api/cloud-mail/accounts/${userId}/remark`, {
      method: 'PATCH',
      body: JSON.stringify({ remark })
    });
  },

  openUpdateAccountRemark(id: number, remark: string): Promise<{
    ok: true;
    id: number;
    account: string;
    remark: string | null;
  }> {
    return request<{ ok: true; id: number; account: string; remark: string | null }>(
      `/api/open/accounts/${id}/remark`,
      {
        method: 'PATCH',
        body: JSON.stringify({ remark })
      }
    );
  },

  openListAccounts(keyword?: string): Promise<{ items: AccountItem[] }> {
    const query = buildQuery({ keyword });
    return request<{ items: AccountItem[] }>(`/api/open/accounts${query}`);
  }
};
