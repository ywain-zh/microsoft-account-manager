export interface AccountItem {
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
  remark: string | null;
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

export interface StripePaymentRuntimeConfig {
  cardLine: string;
  publishableKey?: string;
}

export interface StripeCaptchaConfig {
  clientKey: string;
}

export type StripeProxyProtocol = 'https' | 'socks5';

export interface StripeProxyConfig {
  enabled: boolean;
  protocol: StripeProxyProtocol;
  proxyLine?: string;
  host: string;
  port: number | null;
  user: string;
  pass: string;
}

export interface StripeProxyTestResponse {
  ok: boolean;
  message: string;
  ip?: string;
}

export interface StripePaymentRequest {
  checkoutInput: string;
  cardIndex?: number;
  configProfile?: string;
  manualToken?: string;
  runtimeConfig?: StripePaymentRuntimeConfig;
}

export type StripePaymentRunStatus = 'running' | 'completed' | 'failed' | 'timeout';

export interface StripePaymentRunStartResponse {
  runId: string;
}

export interface StripePaymentRunLogResponse {
  runId: string;
  status: StripePaymentRunStatus;
  log: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  message: string;
  startedAt: string;
  finishedAt?: string;
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

export type Seven79CardStatus = 'pending' | 'checked' | 'expired' | 'failed';

export interface Seven79CardItem {
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

export interface Seven79ImportResult {
  inserted: number;
  skipped: number;
  errors: Array<{ line: number; raw: string; reason: string }>;
}

export type PpSmsStatus = 'active' | 'expired' | 'failed';

export interface PpSmsItem {
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

export interface PpSmsImportResult {
  inserted: number;
  skipped: number;
  errors: Array<{ line: number; raw: string; reason: string }>;
  items: PpSmsItem[];
}

export interface PpSmsFetchCodeResponse {
  item: PpSmsItem;
  code: string | null;
  message: string;
}

export interface Seven79CardSmsCodeResponse {
  item: Seven79CardItem;
  code: string | null;
  message: string;
}

export interface Seven79CheckResponse {
  item: Seven79CardItem;
  check: {
    category: string | null;
    expiryTime: string | null;
    remainingTimeMs: number | null;
  };
  verify: {
    cardNumber: string | null;
    expiryDate: string | null;
    cvv: string | null;
    phone: string | null;
    smsApi: string | null;
    holderName: string | null;
    address: string | null;
    expiresAt: string | null;
  };
}
