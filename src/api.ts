import type {
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
  IngestConfig,
  ImportResult,
  MailFetchMode,
  OpenAiModelsResponse,
  PpSmsFetchCodeResponse,
  PpSmsImportResult,
  PpSmsItem,
  Seven79CardItem,
  Seven79CardSmsCodeResponse,
  Seven79CheckResponse,
  Seven79ImportResult,
  Sub2ApiConfig,
  Sub2ApiDeleteAccountsResponse,
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
      message = text.trim() || message;
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

  listAccounts(keyword?: string): Promise<{ items: AccountItem[] }> {
    return request<{ items: AccountItem[] }>(`/api/accounts${buildQuery({ keyword })}`);
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

  refreshAccounts(payload?: { accountIds?: number[] }): Promise<BatchActionResult> {
    return request<BatchActionResult>('/api/accounts/refresh', {
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

  getAccountMessages(id: number, mode: MailFetchMode): Promise<AccountMessagesResponse> {
    const params = new URLSearchParams({ mode });
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

  updateSub2ApiConfig(payload: Sub2ApiConfig): Promise<{ item: Sub2ApiConfig }> {
    return request<{ item: Sub2ApiConfig }>('/api/sub2api/config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  listSub2ApiModels(): Promise<OpenAiModelsResponse> {
    return request<OpenAiModelsResponse>('/api/sub2api/models');
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

  startSub2ApiCheck(payload: { modelId: string }, signal?: AbortSignal): Promise<Response> {
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

  listCloudMailAccounts(payload: {
    page: number;
    pageSize: number;
    keyword?: string;
  }): Promise<CloudMailAccountListResponse> {
    return request<CloudMailAccountListResponse>(
      `/api/cloud-mail/accounts${buildQuery({
        page: payload.page,
        pageSize: payload.pageSize,
        keyword: payload.keyword
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
  },

  listSeven79Cards(keyword?: string): Promise<{ items: Seven79CardItem[] }> {
    return request<{ items: Seven79CardItem[] }>(`/api/779/cards${buildQuery({ keyword })}`);
  },

  importSeven79Cards(text: string): Promise<Seven79ImportResult> {
    return request<Seven79ImportResult>('/api/779/cards/import', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
  },

  checkSeven79Card(key: string): Promise<Seven79CheckResponse> {
    return request<Seven79CheckResponse>('/api/779/cards/check', {
      method: 'POST',
      body: JSON.stringify({ key })
    });
  },

  extractSeven79Card(id: number): Promise<{ item: Seven79CardItem }> {
    return request<{ item: Seven79CardItem }>(`/api/779/cards/${id}/extract`, {
      method: 'POST'
    });
  },

  fetchSeven79CardCode(id: number): Promise<Seven79CardSmsCodeResponse> {
    return request<Seven79CardSmsCodeResponse>(`/api/779/cards/${id}/fetch-code`, {
      method: 'POST'
    });
  },

  extractAllSeven79Cards(payload?: { ids?: number[] }): Promise<{
    total: number;
    success: number;
    failure: number;
    items: Seven79CardItem[];
  }> {
    return request<{ total: number; success: number; failure: number; items: Seven79CardItem[] }>(
      '/api/779/cards/extract-all',
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {})
      }
    );
  },

  deleteSeven79Card(id: number): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/779/cards/${id}`, {
      method: 'DELETE'
    });
  },

  listPpSmsItems(): Promise<{ items: PpSmsItem[] }> {
    return request<{ items: PpSmsItem[] }>('/api/779/pp-sms');
  },

  importPpSmsItems(text: string): Promise<PpSmsImportResult> {
    return request<PpSmsImportResult>('/api/779/pp-sms/import', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
  },

  fetchPpSmsCode(id: number): Promise<PpSmsFetchCodeResponse> {
    return request<PpSmsFetchCodeResponse>(`/api/779/pp-sms/${id}/fetch-code`, {
      method: 'POST'
    });
  },

  deletePpSmsItem(id: number): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/779/pp-sms/${id}`, {
      method: 'DELETE'
    });
  }
};
