export interface AccountItem {
  id: number;
  account: string;
  rowType: 'primary' | 'alias';
  rowId: string;
  primaryAccountId: number;
  primaryAccount: string;
  aliasId: number | null;
  aliases: string[];
  aliasCount: number;
  matchedAlias: string | null;
  password: string;
  clientId: string | null;
  clientSecret: string | null;
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
  mailFetchProvider: 'graph' | 'imap' | null;
  mailFetchScope: 'graph-mail-read' | 'graph-default' | 'imap-oauth' | null;
  mailFetchErrorCode: string | null;
  mailFetchStrategyUpdatedAt: string | null;
  tokenCountdownDays: number | null;
  tokenBaseAt: string | null;
  gptValidity: Sub2ApiGptValidityResponse | null;
}

export interface AccountPayload {
  account: string;
  password: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  remark?: string;
}

export interface AccountAliasItem {
  id: number;
  accountId: number;
  aliasAccount: string;
  createdAt: string;
  updatedAt: string;
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
  clientSecretField: string;
  tokenField: string;
}

export interface ExternalApiConfig {
  mailApiToken: string;
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
  remark: string | null;
  gptValidity: Sub2ApiGptValidityResponse | null;
}

export interface CloudMailAccountListResponse {
  items: CloudMailAccountItem[];
  total: number;
  page: number;
  pageSize: number;
  syncedAt?: string | null;
  cacheEmpty?: boolean;
}

export interface CloudMailCreatePayload {
  localPart: string;
  domain: string;
}

export interface CloudMailSyncResponse {
  ok: true;
  synced: number;
  syncedAt: string;
}

export interface CloudMailShareResponse {
  email: string;
  shareUrl: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface CloudMailPublicShareInboxResponse {
  account: string;
  messages: AccountMailItem[];
  readonly: true;
}

export interface Sub2ApiConfig {
  baseUrl: string;
  adminApiKey: string;
}

export interface Sub2ApiLongLinkConfig {
  proxyPool: string;
}

export interface Sub2ApiLongLinkProxyCheckResponse {
  ok: true;
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  timezone: string;
  isp: string;
  loc: string;
  proxyUsed: string;
  direct: boolean;
}

export interface Sub2ApiLongLinkCheckoutPayload {
  token: string;
  plan: 'plus' | 'team';
  country: string;
  currency: string;
  locale: string;
  usePromo: boolean;
  promoCode?: string;
  workspaceName?: string;
  seatQuantity?: number;
  proxyPool?: string;
}

export interface Sub2ApiLongLinkCheckoutResponse {
  ok: true;
  url: string;
  chatgptCheckoutUrl: string;
  openaiPayUrl: string;
  proxyUsed: string;
  direct: boolean;
  raw: unknown;
}

export interface Sub2ApiReauthConfig {
  authMode: 'admin-api-key' | 'password';
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

export interface Sub2ApiGroupItem {
  id: number | null;
  name: string;
}

export interface Sub2ApiGroupsResponse {
  items: Sub2ApiGroupItem[];
  syncedAt: string;
}

export interface Sub2ApiReauthTarget {
  accountId?: number;
  accountEmail: string;
  accountName?: string | null;
  reason?: string;
}

export interface Sub2ApiReauthStartPayload {
  targets: Sub2ApiReauthTarget[];
  credentialMode: 'browser-login' | 'browser-oauth' | 'session-json' | 'access-token';
  sessionPayload?: unknown;
  sessionPayloads?: Record<string, unknown>;
  oauthDraft?: unknown;
  oauthCallbackUrl?: string;
  dryRun?: boolean;
  verifyAfterImport?: boolean;
  allowAccessTokenOnly?: boolean;
  strictEmailMatch?: boolean;
  modelId?: string;
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

export type Sub2ApiReauthTaskStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface Sub2ApiReauthTaskStartResponse {
  taskId: string;
}

export interface Sub2ApiReauthTaskResponse {
  taskId: string;
  status: Sub2ApiReauthTaskStatus;
  createdAt: string;
  updatedAt: string;
  logs: Sub2ApiDetectionLogItem[];
  progress: Sub2ApiDetectionProgress;
  summary: Sub2ApiReauthSummary | null;
  error: string | null;
}

export interface Sub2ApiGptValidityResponse {
  email: string;
  valid: boolean;
  status: 'valid' | 'invalid' | 'missing';
  message: string;
  accountId: number | null;
  accountName: string | null;
  planType: Sub2ApiPlanType;
  checkedAt: string;
}

export type MailGptValidityService = 'microsoft' | 'cloud-mail';

export type TranslationProvider = 'openai' | 'deeplx';

export interface TranslationConfig {
  enabled: boolean;
  priorityProvider: TranslationProvider;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  deeplxBaseUrl: string;
  deeplxApiKey: string;
}

export interface TranslationResponse {
  provider: TranslationProvider;
  model?: string;
  translatedText: string;
  translatedHtml?: string;
}

export interface TranslationTestResult {
  provider: TranslationProvider;
  ok: boolean;
  message: string;
  translatedText?: string;
  model?: string;
}

export interface TranslationTestResponse {
  results: TranslationTestResult[];
}

export interface OpenAiModelsResponse {
  items: string[];
}

export type SystemBackupStatus = 'running' | 'success' | 'error';

export interface SystemBackupJob {
  id: string;
  status: SystemBackupStatus;
  createdAt: string;
  updatedAt: string;
  progress: number;
  message: string;
  logs: string[];
  filename: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  error: string | null;
}

export interface SystemBackupJobResponse {
  item: SystemBackupJob;
}

export type Sub2ApiPlanType = 'free' | 'plus' | 'team' | '';
export type GptPlanFilter = Sub2ApiPlanType | 'empty';
export type Sub2ApiDetectionOutcome = 'success' | 'quota' | 'unauthorized' | 'timeout' | 'abnormal';
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
  accountEmail?: string | null;
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
  accountEmail: string | null;
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

export type TokenRefreshStreamEvent =
  | { type: 'start'; total: number }
  | { type: 'account-start'; index: number; total: number; account: string }
  | { type: 'account-done'; index: number; total: number; detail: BatchActionDetail }
  | { type: 'done'; result: BatchActionResult }
  | { type: 'error'; message: string };

export interface AccountMailItem {
  id: string;
  subject: string;
  from: string;
  toRecipients?: MailRecipient[];
  ccRecipients?: MailRecipient[];
  matchedRecipients?: string[];
  recipientMatchKind?: 'requested' | 'other' | 'unknown';
  receivedAt: string;
  preview: string;
  contentType: string;
  content: string;
  folderKind: 'inbox' | 'junk';
  folderLabel: string;
  isRead: boolean | null;
}

export interface MailRecipient {
  name: string;
  address: string;
  display: string;
}

export interface AccountMessagesResponse {
  accountId: number;
  account: string;
  requestedEmail?: string;
  resolvedAccount?: string;
  matchedAlias?: string | null;
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
