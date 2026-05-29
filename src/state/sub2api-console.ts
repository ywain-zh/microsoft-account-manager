import { computed, reactive, ref, watch } from 'vue';
import { createDiscreteApi } from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import type {
  Sub2ApiConfig,
  Sub2ApiDeleteAccountsResponse,
  Sub2ApiDetectionLogItem,
  Sub2ApiDetectionProgress,
  Sub2ApiDetectionSummary,
  Sub2ApiDetectedIssueItem,
  Sub2ApiGroupItem,
  Sub2ApiLogLevel,
  Sub2ApiReauthConfig,
  Sub2ApiReauthStartPayload,
  Sub2ApiReauthTarget,
  Sub2ApiReauthTaskResponse
} from '../types';

const { message } = createDiscreteApi(['message']);
const DEFAULT_SUB2API_MODEL_ID = 'gpt-5.5';
const SUB2API_MODEL_STORAGE_KEY = 'sub2api-checker-model-id';
const MAX_LOG_ITEMS = 1200;
const ABNORMAL_ACCOUNTS_PAGE_SIZE = 10;
const REAUTH_TASK_POLL_INTERVAL_MS = 2000;

function createDefaultConfig(): Sub2ApiConfig {
  return {
    baseUrl: '',
    adminApiKey: ''
  };
}

function createDefaultReauthConfig(): Sub2ApiReauthConfig {
  return {
    authMode: 'admin-api-key',
    adminEmail: '',
    adminPassword: '',
    groupNames: ['openai-plus'],
    defaultProxyName: '',
    accountPriority: 1,
    updateExisting: true,
    autoPauseOnExpired: true,
    verifyAfterImport: true,
    strictEmailMatch: true,
    allowAccessTokenOnly: false
  };
}

function createDefaultReauthForm() {
  return {
    targetEmail: '',
    credentialMode: 'browser-login' as 'browser-login' | 'session-json' | 'access-token',
    sessionPayloadText: '',
    dryRun: true,
    verifyAfterImport: true,
    allowAccessTokenOnly: false,
    strictEmailMatch: true
  };
}

function createDefaultSummary(): Sub2ApiDetectionSummary {
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

function createDefaultProgress(): Sub2ApiDetectionProgress {
  return {
    totalAccounts: 0,
    processedAccounts: 0,
    currentAccountId: null,
    currentAccountName: null
  };
}

const initialDataLoaded = ref(false);
const configLoaded = ref(false);
const configSaving = ref(false);
const reauthConfigSaving = ref(false);
const runLoading = ref(false);
const reauthLoading = ref(false);
const deleteLoading = ref(false);
const modelLoading = ref(false);
const groupLoading = ref(false);
const showReauthModal = ref(false);
const showUnauthorizedAccountsModal = ref(false);
const showAbnormalAccountsModal = ref(false);
const unauthorizedAccountsPage = ref(1);
const abnormalAccountsPage = ref(1);
const abnormalDeletingAccountIds = ref<number[]>([]);
const selectedModelId = ref(readStoredModelId());
const modelItems = ref<string[]>([]);
const groupItems = ref<Sub2ApiGroupItem[]>([]);
const groupSyncMessage = ref('尚未同步分组');
const groupSyncedAt = ref<string | null>(null);
const groupSyncError = ref(false);

const storedConfig = reactive<Sub2ApiConfig>(createDefaultConfig());
const configForm = reactive<Sub2ApiConfig>(createDefaultConfig());
const reauthConfig = reactive<Sub2ApiReauthConfig>(createDefaultReauthConfig());
const reauthConfigForm = reactive<Sub2ApiReauthConfig>(createDefaultReauthConfig());
const reauthForm = reactive(createDefaultReauthForm());
const summary = reactive<Sub2ApiDetectionSummary>(createDefaultSummary());
const progress = reactive<Sub2ApiDetectionProgress>(createDefaultProgress());
const logs = ref<Sub2ApiDetectionLogItem[]>([]);
const unauthorizedCandidates = ref<Sub2ApiDetectedIssueItem[]>([]);
const abnormalCandidates = ref<Sub2ApiDetectedIssueItem[]>([]);

const hasConfiguredSub2Api = computed(() => {
  return Boolean(storedConfig.baseUrl && storedConfig.adminApiKey);
});

const hasUnauthorizedCandidates = computed(() => {
  return unauthorizedCandidates.value.length > 0;
});

const hasAbnormalCandidates = computed(() => {
  return abnormalCandidates.value.length > 0;
});

const unauthorizedCandidatesTotal = computed(() => {
  return unauthorizedCandidates.value.length;
});

const abnormalCandidatesTotal = computed(() => {
  return abnormalCandidates.value.length;
});

const unauthorizedAccountsTotalPages = computed(() => {
  return Math.max(1, Math.ceil(unauthorizedCandidatesTotal.value / ABNORMAL_ACCOUNTS_PAGE_SIZE));
});

const abnormalAccountsTotalPages = computed(() => {
  return Math.max(1, Math.ceil(abnormalCandidatesTotal.value / ABNORMAL_ACCOUNTS_PAGE_SIZE));
});

const pagedUnauthorizedCandidates = computed(() => {
  const start = (unauthorizedAccountsPage.value - 1) * ABNORMAL_ACCOUNTS_PAGE_SIZE;
  return unauthorizedCandidates.value.slice(start, start + ABNORMAL_ACCOUNTS_PAGE_SIZE);
});

const pagedAbnormalCandidates = computed(() => {
  const start = (abnormalAccountsPage.value - 1) * ABNORMAL_ACCOUNTS_PAGE_SIZE;
  return abnormalCandidates.value.slice(start, start + ABNORMAL_ACCOUNTS_PAGE_SIZE);
});

const modelId = computed<string>({
  get() {
    return selectedModelId.value;
  },
  set(value) {
    selectedModelId.value = normalizeModelId(value);
  }
});

const modelOptions = computed(() => {
  const values = [modelId.value, DEFAULT_SUB2API_MODEL_ID, ...modelItems.value].filter(Boolean);
  return Array.from(new Set(values)).map((value) => ({
    label: value,
    value
  }));
});

const selectedReauthGroupName = computed<string | null>({
  get() {
    return reauthConfigForm.groupNames[0]?.trim() || null;
  },
  set(value) {
    const groupName = value?.trim();
    reauthConfigForm.groupNames = groupName ? [groupName] : [];
  }
});

const groupOptions = computed(() => {
  const values = [
    ...groupItems.value.map((item) => item.name),
    ...reauthConfigForm.groupNames
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(values.map((item) => item.toLowerCase())))
    .map((key) => values.find((item) => item.toLowerCase() === key) ?? key)
    .map((value) => ({
      label: value,
      value
    }));
});

const groupSyncStatusText = computed(() => {
  if (groupLoading.value) {
    return '正在同步 Sub2API 分组...';
  }

  return groupSyncMessage.value;
});

let initialLoadPromise: Promise<void> | null = null;
let currentAbortController: AbortController | null = null;
let reauthPollTimer: number | null = null;

watch(selectedModelId, (value) => {
  persistModelId(value);
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function handleApiError(error: unknown): void {
  if (error instanceof UnauthorizedError) {
    message.warning('登录已过期，请重新登录');

    if (typeof window !== 'undefined') {
      const redirect = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`);
    }
    return;
  }

  message.error(getErrorMessage(error));
}

function normalizeModelId(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || DEFAULT_SUB2API_MODEL_ID;
}

function readStoredModelId(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_SUB2API_MODEL_ID;
  }

  return normalizeModelId(window.localStorage.getItem(SUB2API_MODEL_STORAGE_KEY));
}

function persistModelId(value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SUB2API_MODEL_STORAGE_KEY, normalizeModelId(value));
}

function formatStatusTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function assignConfig(target: Sub2ApiConfig, source: Sub2ApiConfig): void {
  target.baseUrl = source.baseUrl;
  target.adminApiKey = source.adminApiKey;
}

function assignReauthConfig(target: Sub2ApiReauthConfig, source: Sub2ApiReauthConfig): void {
  target.authMode = 'admin-api-key';
  target.adminEmail = '';
  target.adminPassword = '';
  target.groupNames = [...source.groupNames];
  target.defaultProxyName = source.defaultProxyName;
  target.accountPriority = source.accountPriority;
  target.updateExisting = source.updateExisting;
  target.autoPauseOnExpired = source.autoPauseOnExpired;
  target.verifyAfterImport = source.verifyAfterImport;
  target.strictEmailMatch = source.strictEmailMatch;
  target.allowAccessTokenOnly = source.allowAccessTokenOnly;
}

function assignSummary(target: Sub2ApiDetectionSummary, source: Partial<Sub2ApiDetectionSummary>): void {
  target.totalAccounts = Number(source.totalAccounts ?? target.totalAccounts);
  target.processedAccounts = Number(source.processedAccounts ?? target.processedAccounts);
  target.availableAccounts = Number(source.availableAccounts ?? target.availableAccounts);
  target.freeAvailableAccounts = Number(source.freeAvailableAccounts ?? target.freeAvailableAccounts);
  target.plusAvailableAccounts = Number(source.plusAvailableAccounts ?? target.plusAvailableAccounts);
  target.teamAvailableAccounts = Number(source.teamAvailableAccounts ?? target.teamAvailableAccounts);
  target.quotaExhaustedAccounts = Number(source.quotaExhaustedAccounts ?? target.quotaExhaustedAccounts);
  target.unauthorizedAccounts = Number(source.unauthorizedAccounts ?? target.unauthorizedAccounts);
  target.abnormalAccounts = Number(source.abnormalAccounts ?? target.abnormalAccounts);
}

function assignProgress(target: Sub2ApiDetectionProgress, source: Partial<Sub2ApiDetectionProgress>): void {
  target.totalAccounts = Number(source.totalAccounts ?? target.totalAccounts);
  target.processedAccounts = Number(source.processedAccounts ?? target.processedAccounts);
  target.currentAccountId = source.currentAccountId ?? target.currentAccountId ?? null;
  target.currentAccountName = source.currentAccountName ?? target.currentAccountName ?? null;
  target.outcome = source.outcome ?? target.outcome;
}

function assignSummaryFromReauth(target: Sub2ApiDetectionSummary, source: { totalAccounts: number; processedAccounts: number; succeededAccounts: number; failedAccounts: number }): void {
  target.totalAccounts = source.totalAccounts;
  target.processedAccounts = source.processedAccounts;
  target.availableAccounts = source.succeededAccounts;
  target.unauthorizedAccounts = source.failedAccounts;
}

function resetSummary(): void {
  assignSummary(summary, createDefaultSummary());
}

function resetProgress(): void {
  assignProgress(progress, createDefaultProgress());
}

function clearLogs(): void {
  logs.value = [];
}

function exportUnauthorizedAccounts(): void {
  if (unauthorizedCandidates.value.length === 0) {
    message.warning('当前没有可导出的 401 账号');
    return;
  }

  const exportedAt = new Date().toISOString();
  const payload = {
    exportedAt,
    total: unauthorizedCandidates.value.length,
    items: unauthorizedCandidates.value.map((item) => ({
      accountId: item.accountId,
      accountEmail: item.accountEmail,
      accountName: item.accountName,
      reason: item.reason
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeTime = exportedAt.replace(/[:.]/g, '-');
  link.href = url;
  link.download = `sub2api-401-accounts-${safeTime}.json`;
  link.click();
  URL.revokeObjectURL(url);
  message.success(`已导出 ${payload.total} 个 401 账号`);
}

function resetDetectedIssues(): void {
  unauthorizedCandidates.value = [];
  abnormalCandidates.value = [];
  closeUnauthorizedAccountsModal();
  closeAbnormalAccountsModal();
  abnormalDeletingAccountIds.value = [];
}

function appendLog(payload: Partial<Sub2ApiDetectionLogItem>): void {
  const item: Sub2ApiDetectionLogItem = {
    id: String(payload.id ?? `${Date.now()}-${logs.value.length + 1}`),
    timestamp: typeof payload.timestamp === 'string' && payload.timestamp ? payload.timestamp : new Date().toISOString(),
    level: normalizeLogLevel(payload.level),
    message: typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : '收到一条日志',
    accountId: typeof payload.accountId === 'number' ? payload.accountId : null,
    accountName: typeof payload.accountName === 'string' ? payload.accountName : null,
    accountEmail: typeof payload.accountEmail === 'string' ? payload.accountEmail : null
  };

  captureDetectionIssue(item);

  const nextLogs = [...logs.value, item];
  logs.value = nextLogs.length > MAX_LOG_ITEMS ? nextLogs.slice(-MAX_LOG_ITEMS) : nextLogs;
}

function normalizeLogLevel(value: unknown): Sub2ApiLogLevel {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'success' || normalized === 'warning' || normalized === 'error') {
    return normalized;
  }
  return 'info';
}

function captureDetectionIssue(item: Sub2ApiDetectionLogItem): void {
  if (typeof item.accountId !== 'number' || item.accountId <= 0) {
    return;
  }

  const messageText = item.message.trim();
  if (!messageText) {
    return;
  }

  if (messageText.startsWith('检测命中 401：')) {
    upsertDetectedIssue(unauthorizedCandidates, {
      accountId: item.accountId,
      accountName: item.accountName ?? null,
      accountEmail: item.accountEmail ?? null,
      reason: trimIssueReason(messageText, '检测命中 401：')
    });
    return;
  }

  if (messageText.startsWith('检测超时：')) {
    upsertDetectedIssue(abnormalCandidates, {
      accountId: item.accountId,
      accountName: item.accountName ?? null,
      accountEmail: item.accountEmail ?? null,
      reason: trimIssueReason(messageText, '检测超时：')
    });
    return;
  }

  if (messageText.startsWith('检测异常：')) {
    upsertDetectedIssue(abnormalCandidates, {
      accountId: item.accountId,
      accountName: item.accountName ?? null,
      accountEmail: item.accountEmail ?? null,
      reason: trimIssueReason(messageText, '检测异常：')
    });
  }
}

function upsertDetectedIssue(
  target: { value: Sub2ApiDetectedIssueItem[] },
  item: Sub2ApiDetectedIssueItem
): void {
  const nextItems = [...target.value];
  const index = nextItems.findIndex((entry) => entry.accountId === item.accountId);

  if (index >= 0) {
    nextItems[index] = item;
  } else {
    nextItems.push(item);
  }

  target.value = nextItems;
}

function trimIssueReason(messageText: string, prefix: string): string {
  return messageText.startsWith(prefix) ? messageText.slice(prefix.length).trim() : messageText.trim();
}

function resolveIssueLabel(item: Pick<Sub2ApiDetectedIssueItem, 'accountId' | 'accountName' | 'accountEmail'>): string {
  return item.accountEmail?.trim() || item.accountName?.trim() || `账号 ID ${item.accountId}`;
}

function openUnauthorizedAccountsModal(): void {
  if (!hasUnauthorizedCandidates.value) {
    return;
  }

  unauthorizedAccountsPage.value = 1;
  showUnauthorizedAccountsModal.value = true;
}

function closeUnauthorizedAccountsModal(): void {
  showUnauthorizedAccountsModal.value = false;
  unauthorizedAccountsPage.value = 1;
}

function openAbnormalAccountsModal(): void {
  if (!hasAbnormalCandidates.value) {
    return;
  }

  abnormalAccountsPage.value = 1;
  showAbnormalAccountsModal.value = true;
}

function closeAbnormalAccountsModal(): void {
  showAbnormalAccountsModal.value = false;
  abnormalAccountsPage.value = 1;
}

function setUnauthorizedAccountsPage(page: number): void {
  unauthorizedAccountsPage.value = Math.min(Math.max(1, page), unauthorizedAccountsTotalPages.value);
}

function setAbnormalAccountsPage(page: number): void {
  abnormalAccountsPage.value = Math.min(Math.max(1, page), abnormalAccountsTotalPages.value);
}

function ensureUnauthorizedAccountsPageInRange(): void {
  unauthorizedAccountsPage.value = Math.min(unauthorizedAccountsPage.value, unauthorizedAccountsTotalPages.value);
}

function ensureAbnormalAccountsPageInRange(): void {
  abnormalAccountsPage.value = Math.min(abnormalAccountsPage.value, abnormalAccountsTotalPages.value);
}

function removeDetectedIssues(target: { value: Sub2ApiDetectedIssueItem[] }, accountIds: number[]): void {
  if (accountIds.length === 0) {
    return;
  }

  const deletedIds = new Set(accountIds);
  target.value = target.value.filter((item) => !deletedIds.has(item.accountId));
}

function syncSummaryAfterDelete(deletedCount: number, category: 'unauthorized' | 'abnormal'): void {
  if (deletedCount <= 0) {
    return;
  }

  summary.totalAccounts = Math.max(0, summary.totalAccounts - deletedCount);
  summary.processedAccounts = Math.min(summary.processedAccounts, summary.totalAccounts);
  progress.totalAccounts = summary.totalAccounts;
  progress.processedAccounts = Math.min(progress.processedAccounts, progress.totalAccounts);

  if (category === 'unauthorized') {
    summary.unauthorizedAccounts = Math.max(0, summary.unauthorizedAccounts - deletedCount);
    return;
  }

  summary.abnormalAccounts = Math.max(0, summary.abnormalAccounts - deletedCount);
}

async function deleteDetectedAccountsByIds(
  accountIds: number[],
  options: {
    source: 'unauthorized' | 'abnormal';
    candidates: Sub2ApiDetectedIssueItem[];
    startMessage: string;
    completeMessage: string;
    successMessage: string;
    emptyMessage: string;
    skippedMessage: string;
  }
): Promise<Sub2ApiDeleteAccountsResponse | null> {
  const candidates = options.candidates.filter((item) => accountIds.includes(item.accountId) && item.accountId > 0);
  if (candidates.length === 0) {
    message.warning(options.emptyMessage);
    return null;
  }

  appendLog({
    level: 'warning',
    message: options.startMessage
  });

  const result = await api.deleteSub2ApiAccounts({
    accountIds: candidates.map((item) => item.accountId)
  });

  const candidateMap = new Map<number, Sub2ApiDetectedIssueItem>(
    candidates.map((item) => [item.accountId, item])
  );
  const deletedIds = new Set<number>();

  for (const detail of result.details) {
    const candidate = candidateMap.get(detail.accountId);
    const label = resolveIssueLabel({
      accountId: detail.accountId,
      accountName: candidate?.accountName ?? null,
      accountEmail: candidate?.accountEmail ?? null
    });

    appendLog({
      level: detail.ok ? 'success' : 'warning',
      message: detail.ok
        ? `[${label}] 删除完成：${detail.message}`
        : `[${label}] 删除失败：${detail.message}`,
      accountId: detail.accountId,
      accountName: candidate?.accountName ?? null,
      accountEmail: candidate?.accountEmail ?? null
    });

    if (detail.ok) {
      deletedIds.add(detail.accountId);
    }
  }

  if (deletedIds.size > 0) {
    const deletedIdList = Array.from(deletedIds);
    removeDetectedIssues(unauthorizedCandidates, deletedIdList);
    removeDetectedIssues(abnormalCandidates, deletedIdList);
    syncSummaryAfterDelete(deletedIds.size, options.source);
    ensureUnauthorizedAccountsPageInRange();
    ensureAbnormalAccountsPageInRange();
  }

  appendLog({
    level: result.skipped > 0 ? 'warning' : 'success',
    message:
      result.skipped > 0
        ? `${options.completeMessage}：成功删除 ${result.deleted}/${result.total} 个，剩余 ${result.skipped} 个未删除`
        : `${options.completeMessage}：成功删除 ${result.deleted}/${result.total} 个`
  });

  if (result.deleted > 0) {
    message.success(options.successMessage.replace('{deleted}', String(result.deleted)).replace('{total}', String(result.total)));
  } else {
    message.warning(options.skippedMessage);
  }

  return result;
}

async function loadConfig(): Promise<void> {
  try {
    const [configResponse, reauthConfigResponse] = await Promise.all([
      api.getSub2ApiConfig(),
      api.getSub2ApiReauthConfig()
    ]);
    assignConfig(storedConfig, configResponse.item);
    assignConfig(configForm, configResponse.item);
    assignReauthConfig(reauthConfig, reauthConfigResponse.item);
    assignReauthConfig(reauthConfigForm, reauthConfigResponse.item);
    syncReauthFormDefaults();
    configLoaded.value = true;
  } catch (error) {
    handleApiError(error);
  }
}

async function loadInitialData(force = false): Promise<void> {
  if (initialLoadPromise && !force) {
    return initialLoadPromise;
  }

  initialLoadPromise = (async () => {
    await loadConfig();
    initialDataLoaded.value = true;
  })();

  try {
    await initialLoadPromise;
  } finally {
    initialLoadPromise = null;
  }
}

async function refreshModels(): Promise<void> {
  if (!hasConfiguredSub2Api.value) {
    message.warning('请先保存有效的 Sub2API 配置');
    return;
  }

  modelLoading.value = true;
  try {
    const { items } = await api.listSub2ApiModels();
    modelItems.value = items;
    if (items.length === 0) {
      message.warning('没有读取到模型列表');
      return;
    }
    message.success(`已读取 ${items.length} 个模型`);
  } catch (error) {
    handleApiError(error);
  } finally {
    modelLoading.value = false;
  }
}

async function syncSub2ApiGroups(options: { silent?: boolean } = {}): Promise<void> {
  if (!hasConfiguredSub2Api.value) {
    groupSyncError.value = true;
    groupSyncMessage.value = '请先保存有效的 Sub2API 配置';
    if (!options.silent) {
      message.warning(groupSyncMessage.value);
    }
    return;
  }

  groupLoading.value = true;
  try {
    const { items, syncedAt } = await api.listSub2ApiGroups();
    groupItems.value = items;
    groupSyncedAt.value = syncedAt;
    groupSyncError.value = false;
    groupSyncMessage.value = items.length > 0
      ? `已同步 ${items.length} 个分组 · ${formatStatusTime(syncedAt)}`
      : `同步完成，未读取到分组 · ${formatStatusTime(syncedAt)}`;

    if (!selectedReauthGroupName.value && items.length > 0) {
      selectedReauthGroupName.value = items[0].name;
    }

    if (!options.silent) {
      message.success(items.length > 0 ? `已同步 ${items.length} 个分组` : '同步完成，未读取到分组');
    }
  } catch (error) {
    groupSyncError.value = true;
    groupSyncMessage.value = `同步失败：${getErrorMessage(error)}`;
    if (!options.silent) {
      handleApiError(error);
    }
  } finally {
    groupLoading.value = false;
  }
}

function syncReauthFormDefaults(): void {
  reauthForm.verifyAfterImport = reauthConfig.verifyAfterImport;
  reauthForm.allowAccessTokenOnly = reauthConfig.allowAccessTokenOnly;
  reauthForm.strictEmailMatch = reauthConfig.strictEmailMatch;
}

async function saveReauthConfig(): Promise<boolean> {
  const payload: Sub2ApiReauthConfig = {
    ...reauthConfigForm,
    authMode: 'admin-api-key',
    adminEmail: '',
    adminPassword: '',
    groupNames: reauthConfigForm.groupNames.map((item) => item.trim()).filter(Boolean),
    defaultProxyName: reauthConfigForm.defaultProxyName.trim(),
    accountPriority: Number(reauthConfigForm.accountPriority) || 1
  };

  reauthConfigSaving.value = true;
  try {
    const response = await api.updateSub2ApiReauthConfig(payload);
    assignReauthConfig(reauthConfig, response.item);
    assignReauthConfig(reauthConfigForm, response.item);
    syncReauthFormDefaults();
    message.success('401 重新授权配置已保存');
    return true;
  } catch (error) {
    handleApiError(error);
    return false;
  } finally {
    reauthConfigSaving.value = false;
  }
}

async function saveConfig(): Promise<boolean> {
  const payload: Sub2ApiConfig = {
    baseUrl: configForm.baseUrl.trim(),
    adminApiKey: configForm.adminApiKey.trim()
  };

  if (!payload.baseUrl || !payload.adminApiKey) {
    message.warning('请完整填写 Sub2API 地址和管理员 API Key');
    return false;
  }

  configSaving.value = true;
  try {
    const response = await api.updateSub2ApiConfig(payload);
    assignConfig(storedConfig, response.item);
    assignConfig(configForm, response.item);
    message.success('Sub2API 配置已保存');
    return true;
  } catch (error) {
    handleApiError(error);
    return false;
  } finally {
    configSaving.value = false;
  }
}

function stopDetection(): void {
  currentAbortController?.abort();
  currentAbortController = null;
  stopReauthPolling();
  runLoading.value = false;
  reauthLoading.value = false;
}

function openReauthModal(item?: Sub2ApiDetectedIssueItem): void {
  const target = item ?? unauthorizedCandidates.value[0];
  reauthForm.targetEmail = target?.accountEmail?.trim() || '';
  syncReauthFormDefaults();
  showReauthModal.value = true;
}

function closeReauthModal(): void {
  if (reauthLoading.value) {
    return;
  }
  showReauthModal.value = false;
}

function buildReauthTargets(): Sub2ApiReauthTarget[] {
  const email = reauthForm.targetEmail.trim().toLowerCase();
  if (email) {
    const matched = unauthorizedCandidates.value.find((item) => item.accountEmail?.toLowerCase() === email);
    return [{
      accountId: matched?.accountId,
      accountEmail: email,
      accountName: matched?.accountName ?? null,
      reason: matched?.reason
    }];
  }

  return unauthorizedCandidates.value
    .filter((item) => item.accountEmail?.trim())
    .map((item) => ({
      accountId: item.accountId,
      accountEmail: item.accountEmail ?? '',
      accountName: item.accountName,
      reason: item.reason
    }));
}

function parseReauthSessionPayload(): unknown {
  if (reauthForm.credentialMode === 'browser-login') {
    return null;
  }

  const text = reauthForm.sessionPayloadText.trim();
  if (!text) {
    throw new Error(reauthForm.credentialMode === 'access-token' ? '请粘贴 accessToken' : '请粘贴 ChatGPT session JSON');
  }

  if (reauthForm.credentialMode === 'access-token') {
    return text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('ChatGPT session JSON 格式不合法');
  }
}

async function startReauth(): Promise<void> {
  if (!hasConfiguredSub2Api.value) {
    message.warning('请先保存有效的 Sub2API 配置');
    return;
  }
  if (runLoading.value || reauthLoading.value) {
    return;
  }

  const targets = buildReauthTargets();
  if (targets.length === 0) {
    message.warning('请先填写目标邮箱，或先运行检测获取 401 账号');
    return;
  }

  let sessionPayload: unknown;
  try {
    sessionPayload = parseReauthSessionPayload();
  } catch (error) {
    message.warning(getErrorMessage(error));
    return;
  }

  clearLogs();
  resetProgress();
  progress.totalAccounts = targets.length;
  reauthLoading.value = true;
  const abortController = new AbortController();
  currentAbortController = abortController;

  const payload: Sub2ApiReauthStartPayload = {
    targets,
    credentialMode: reauthForm.credentialMode,
    sessionPayload,
    dryRun: reauthForm.dryRun,
    verifyAfterImport: reauthForm.verifyAfterImport,
    allowAccessTokenOnly: reauthForm.allowAccessTokenOnly,
    strictEmailMatch: reauthForm.strictEmailMatch,
    modelId: modelId.value
  };

  try {
    const response = await api.startSub2ApiReauth(payload, abortController.signal);
    appendLog({
      level: 'info',
      message: `重新授权后台任务已创建：${response.taskId}`
    });
    showReauthModal.value = false;
    await pollReauthTask(response.taskId, abortController);
    message.success('401 重新授权任务完成');
  } catch (error) {
    if (!isAbortError(error)) {
      handleApiError(error);
    }
  } finally {
    stopReauthPolling();
    if (currentAbortController === abortController) {
      currentAbortController = null;
    }
    reauthLoading.value = false;
  }
}

async function pollReauthTask(taskId: string, abortController: AbortController): Promise<void> {
  let lastLogId = '';

  while (!abortController.signal.aborted) {
    const item = await api.getSub2ApiReauthTask(taskId, abortController.signal);
    applyReauthTaskSnapshot(item, lastLogId);
    lastLogId = item.logs.at(-1)?.id ?? lastLogId;

    if (item.status === 'success') {
      return;
    }
    if (item.status === 'error') {
      throw new Error(item.error || '401 重新授权任务失败');
    }
    if (item.status === 'cancelled') {
      throw new Error('401 重新授权任务已取消');
    }

    await waitForReauthPoll(abortController.signal);
  }
}

function applyReauthTaskSnapshot(item: Sub2ApiReauthTaskResponse, lastLogId: string): void {
  const startIndex = lastLogId ? item.logs.findIndex((log) => log.id === lastLogId) + 1 : 0;
  for (const log of item.logs.slice(Math.max(startIndex, 0))) {
    appendLog(log);
  }
  assignProgress(progress, item.progress);
  if (item.summary) {
    assignSummaryFromReauth(summary, item.summary);
  }
}

function waitForReauthPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    reauthPollTimer = window.setTimeout(() => {
      reauthPollTimer = null;
      resolve();
    }, REAUTH_TASK_POLL_INTERVAL_MS);

    signal.addEventListener('abort', () => {
      stopReauthPolling();
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function stopReauthPolling(): void {
  if (reauthPollTimer !== null) {
    window.clearTimeout(reauthPollTimer);
    reauthPollTimer = null;
  }
}

async function startDetection(): Promise<void> {
  if (!hasConfiguredSub2Api.value) {
    message.warning('请先保存有效的 Sub2API 配置');
    return;
  }

  if (runLoading.value) {
    return;
  }

  resetSummary();
  resetProgress();
  clearLogs();
  resetDetectedIssues();

  runLoading.value = true;
  const abortController = new AbortController();
  currentAbortController = abortController;

  try {
    const response = await api.startSub2ApiCheck({ modelId: modelId.value }, abortController.signal);
    await consumeEventStream(response);
    message.success('Sub2API 账号检测完成');
  } catch (error) {
    if (!isAbortError(error)) {
      handleApiError(error);
    }
  } finally {
    if (currentAbortController === abortController) {
      currentAbortController = null;
    }
    runLoading.value = false;
  }
}

async function clearUnauthorizedAccounts(): Promise<void> {
  const candidates = unauthorizedCandidates.value.filter((item) => item.accountId > 0);
  if (candidates.length === 0) {
    message.warning('当前没有可清除的 401 账号');
    return;
  }

  const confirmed = window.confirm(
    `确认删除本次检测命中的 ${candidates.length} 个 401 账号？此操作会直接从 Sub2API 账户管理中删除，且不可恢复！`
  );
  if (!confirmed) {
    return;
  }

  deleteLoading.value = true;
  try {
    await deleteDetectedAccountsByIds(
      candidates.map((item) => item.accountId),
      {
        source: 'unauthorized',
        candidates,
        startMessage: `开始清除 ${candidates.length} 个 401 账号`,
        completeMessage: '401 清理完成',
        successMessage: '401 账号清理完成：成功删除 {deleted}/{total} 个',
        emptyMessage: '当前没有可清除的 401 账号',
        skippedMessage: '没有 401 账号被删除'
      }
    );
  } catch (error) {
    handleApiError(error);
  } finally {
    deleteLoading.value = false;
  }
}

async function deleteAbnormalAccount(item: Sub2ApiDetectedIssueItem): Promise<void> {
  if (item.accountId <= 0) {
    message.warning('异常账号信息不完整，无法删除');
    return;
  }

  const confirmed = window.confirm(
    `确认删除异常账号 ${resolveIssueLabel(item)}？此操作会直接从 Sub2API 账户管理中删除，且不可恢复！`
  );
  if (!confirmed) {
    return;
  }

  if (abnormalDeletingAccountIds.value.includes(item.accountId)) {
    return;
  }

  abnormalDeletingAccountIds.value = [...abnormalDeletingAccountIds.value, item.accountId];

  try {
    await deleteDetectedAccountsByIds([item.accountId], {
      source: 'abnormal',
      candidates: abnormalCandidates.value,
      startMessage: `开始删除异常账号 ${resolveIssueLabel(item)}`,
      completeMessage: '异常账号清理完成',
      successMessage: '异常账号删除完成：成功删除 {deleted}/{total} 个',
      emptyMessage: '当前没有可删除的异常账号',
      skippedMessage: '异常账号未删除'
    });
  } catch (error) {
    handleApiError(error);
  } finally {
    abnormalDeletingAccountIds.value = abnormalDeletingAccountIds.value.filter((id) => id !== item.accountId);
  }
}

function isDeletingAbnormalAccount(accountId: number): boolean {
  return abnormalDeletingAccountIds.value.includes(accountId);
}

async function consumeEventStream(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('检测流不可用');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    while (true) {
      const separatorIndex = buffer.indexOf('\n\n');
      if (separatorIndex === -1) {
        break;
      }

      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      handleEventBlock(block);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    handleEventBlock(buffer);
  }
}

function handleEventBlock(block: string): void {
  const lines = block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    return;
  }

  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  const payloadText = dataLines.join('\n').trim();
  const payload = parseEventPayload(payloadText);

  if (eventName === 'log') {
    if (payload && typeof payload === 'object') {
      appendLog(payload as Partial<Sub2ApiDetectionLogItem>);
    }
    return;
  }

  if (eventName === 'summary') {
    if (payload && typeof payload === 'object') {
      assignSummary(summary, payload as Partial<Sub2ApiDetectionSummary>);
      progress.totalAccounts = summary.totalAccounts;
    }
    return;
  }

  if (eventName === 'progress') {
    if (payload && typeof payload === 'object') {
      assignProgress(progress, payload as Partial<Sub2ApiDetectionProgress>);
    }
    return;
  }

  if (eventName === 'done') {
    if (payload && typeof payload === 'object' && 'summary' in payload) {
      const donePayload = payload as { summary?: Partial<Sub2ApiDetectionSummary> };
      if (donePayload.summary) {
        assignSummary(summary, donePayload.summary);
        progress.totalAccounts = summary.totalAccounts;
        progress.processedAccounts = summary.processedAccounts;
      }
    }
    return;
  }

  if (eventName === 'error') {
    const messageText =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message?: unknown }).message ?? '检测失败')
        : '检测失败';
    appendLog({
      level: 'error',
      message: messageText
    });
    throw new Error(messageText);
  }

  if (payloadText) {
    appendLog({
      level: 'info',
      message: payloadText
    });
  }
}

function parseEventPayload(payloadText: string): unknown {
  try {
    return JSON.parse(payloadText) as unknown;
  } catch {
    return payloadText;
  }
}

export function useSub2ApiConsole() {
  return {
    initialDataLoaded,
    configLoaded,
    configSaving,
    reauthConfigSaving,
    runLoading,
    reauthLoading,
    deleteLoading,
    modelLoading,
    groupLoading,
    showReauthModal,
    showUnauthorizedAccountsModal,
    showAbnormalAccountsModal,
    unauthorizedAccountsPage,
    abnormalAccountsPage,
    abnormalAccountsPageSize: ABNORMAL_ACCOUNTS_PAGE_SIZE,
    storedConfig,
    configForm,
    reauthConfig,
    reauthConfigForm,
    reauthForm,
    summary,
    progress,
    logs,
    unauthorizedCandidates,
    abnormalCandidates,
    pagedUnauthorizedCandidates,
    pagedAbnormalCandidates,
    unauthorizedCandidatesTotal,
    abnormalCandidatesTotal,
    unauthorizedAccountsTotalPages,
    abnormalAccountsTotalPages,
    modelId,
    modelOptions,
    selectedReauthGroupName,
    groupItems,
    groupOptions,
    groupSyncStatusText,
    groupSyncError,
    groupSyncedAt,
    hasConfiguredSub2Api,
    hasUnauthorizedCandidates,
    hasAbnormalCandidates,
    loadConfig,
    loadInitialData,
    refreshModels,
    syncSub2ApiGroups,
    saveConfig,
    saveReauthConfig,
    clearLogs,
    exportUnauthorizedAccounts,
    openReauthModal,
    closeReauthModal,
    startReauth,
    openUnauthorizedAccountsModal,
    closeUnauthorizedAccountsModal,
    setUnauthorizedAccountsPage,
    openAbnormalAccountsModal,
    closeAbnormalAccountsModal,
    setAbnormalAccountsPage,
    startDetection,
    clearUnauthorizedAccounts,
    deleteAbnormalAccount,
    isDeletingAbnormalAccount,
    stopDetection
  };
}
