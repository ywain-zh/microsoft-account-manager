export interface AccountItem {
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
  tokenCountdownDays: number | null;
  tokenBaseAt: string | null;
}

export interface AccountPayload {
  account: string;
  password: string;
  clientId?: string;
  refreshToken?: string;
  remark?: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: Array<{ line: number; raw: string; reason: string }>;
}

export interface IngestConfig {
  delimiter: string;
  captchaField: string;
  accountField: string;
  passwordField: string;
  clientIdField: string;
  tokenField: string;
}

export interface CloudMailConfig {
  apiBaseUrl: string;
  adminEmail: string;
  adminPassword: string;
  availableDomains: string[];
}

export interface CloudMailAccountItem {
  userId: number;
  email: string;
  status: number;
  receiveEmailCount: number;
  sendEmailCount: number;
  activeTime: string | null;
  createTime: string | null;
}

export interface CloudMailAccountListResponse {
  items: CloudMailAccountItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CloudMailCreatePayload {
  localPart: string;
  domain: string;
}

export interface Sub2ApiConfig {
  baseUrl: string;
  adminApiKey: string;
}

export type Sub2ApiPlanType = 'free' | 'plus' | 'team' | '';
export type Sub2ApiDetectionOutcome = 'success' | 'quota' | 'unauthorized' | 'abnormal';
export type Sub2ApiLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface Sub2ApiDetectionSummary {
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

export interface Sub2ApiDetectionLogItem {
  id: string;
  timestamp: string;
  level: Sub2ApiLogLevel;
  message: string;
  accountId?: number | null;
  accountName?: string | null;
}

export interface Sub2ApiDetectionProgress {
  totalAccounts: number;
  processedAccounts: number;
  currentAccountId?: number | null;
  currentAccountName?: string | null;
  outcome?: Sub2ApiDetectionOutcome;
}

export interface Sub2ApiDetectedIssueItem {
  accountId: number;
  accountName: string | null;
  reason: string;
}

export interface Sub2ApiDeleteAccountDetail {
  accountId: number;
  ok: boolean;
  message: string;
}

export interface Sub2ApiDeleteAccountsResponse {
  ok: true;
  total: number;
  deleted: number;
  skipped: number;
  details: Sub2ApiDeleteAccountDetail[];
}

export type TokenStatus = 'unknown' | 'valid' | 'invalid';

export type MailFetchMode = 'auto' | 'graph' | 'imap';
export type ResolvedMailFetchMode = 'graph' | 'imap';

export interface BatchActionDetail {
  id: number;
  account: string;
  ok: boolean;
  message: string;
  fetchedCount?: number;
}

export interface BatchActionResult {
  total: number;
  success: number;
  failure: number;
  details: BatchActionDetail[];
}

export interface AccountMailItem {
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

export interface AccountMessagesResponse {
  accountId: number;
  account: string;
  mode: MailFetchMode;
  resolvedMode: ResolvedMailFetchMode;
  messages: AccountMailItem[];
}

export interface CloudMailMessagesResponse {
  account: string;
  messages: AccountMailItem[];
}

export interface AuthUser {
  username: string;
}
