import type {
  AccountMessagesResponse,
  AccountItem,
  AccountPayload,
  AuthUser,
  BatchActionResult,
  CloudMailAccountListResponse,
  CloudMailConfig,
  CloudMailCreatePayload,
  CloudMailMessagesResponse,
  IngestConfig,
  ImportResult,
  MailFetchMode
} from './types';

interface ApiError {
  message?: string;
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

  getCloudMailConfig(): Promise<{ item: CloudMailConfig }> {
    return request<{ item: CloudMailConfig }>('/api/cloud-mail/config');
  },

  updateCloudMailConfig(payload: CloudMailConfig): Promise<{ item: CloudMailConfig }> {
    return request<{ item: CloudMailConfig }>('/api/cloud-mail/config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
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

  getCloudMailMessages(email: string): Promise<CloudMailMessagesResponse> {
    return request<CloudMailMessagesResponse>(`/api/cloud-mail/messages${buildQuery({ email })}`);
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
