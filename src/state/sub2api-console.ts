import { computed, reactive, ref } from 'vue';
import { createDiscreteApi } from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import type {
  Sub2ApiConfig,
  Sub2ApiDeleteAccountsResponse,
  Sub2ApiDetectionLogItem,
  Sub2ApiDetectionProgress,
  Sub2ApiDetectionSummary,
  Sub2ApiDetectedIssueItem,
  Sub2ApiLogLevel
} from '../types';

const { message } = createDiscreteApi(['message']);
const SUB2API_MODEL_ID = 'gpt-5.4';
const MAX_LOG_ITEMS = 1200;

function createDefaultConfig(): Sub2ApiConfig {
  return {
    baseUrl: '',
    adminApiKey: ''
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
const runLoading = ref(false);
const deleteLoading = ref(false);

const storedConfig = reactive<Sub2ApiConfig>(createDefaultConfig());
const configForm = reactive<Sub2ApiConfig>(createDefaultConfig());
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

let initialLoadPromise: Promise<void> | null = null;
let currentAbortController: AbortController | null = null;

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

function assignConfig(target: Sub2ApiConfig, source: Sub2ApiConfig): void {
  target.baseUrl = source.baseUrl;
  target.adminApiKey = source.adminApiKey;
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

function resetSummary(): void {
  assignSummary(summary, createDefaultSummary());
}

function resetProgress(): void {
  assignProgress(progress, createDefaultProgress());
}

function clearLogs(): void {
  logs.value = [];
}

function resetDetectedIssues(): void {
  unauthorizedCandidates.value = [];
  abnormalCandidates.value = [];
}

function appendLog(payload: Partial<Sub2ApiDetectionLogItem>): void {
  const item: Sub2ApiDetectionLogItem = {
    id: String(payload.id ?? `${Date.now()}-${logs.value.length + 1}`),
    timestamp: typeof payload.timestamp === 'string' && payload.timestamp ? payload.timestamp : new Date().toISOString(),
    level: normalizeLogLevel(payload.level),
    message: typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : '收到一条日志',
    accountId: typeof payload.accountId === 'number' ? payload.accountId : null,
    accountName: typeof payload.accountName === 'string' ? payload.accountName : null
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
      reason: trimIssueReason(messageText, '检测命中 401：')
    });
    return;
  }

  if (messageText.startsWith('检测异常：')) {
    upsertDetectedIssue(abnormalCandidates, {
      accountId: item.accountId,
      accountName: item.accountName ?? null,
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

function resolveIssueLabel(item: Pick<Sub2ApiDetectedIssueItem, 'accountId' | 'accountName'>): string {
  return item.accountName?.trim() || `账号 ID ${item.accountId}`;
}

async function loadConfig(): Promise<void> {
  try {
    const response = await api.getSub2ApiConfig();
    assignConfig(storedConfig, response.item);
    assignConfig(configForm, response.item);
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

async function saveConfig(): Promise<void> {
  const payload: Sub2ApiConfig = {
    baseUrl: configForm.baseUrl.trim(),
    adminApiKey: configForm.adminApiKey.trim()
  };

  if (!payload.baseUrl || !payload.adminApiKey) {
    message.warning('请完整填写 Sub2API 地址和管理员 API Key');
    return;
  }

  configSaving.value = true;
  try {
    const response = await api.updateSub2ApiConfig(payload);
    assignConfig(storedConfig, response.item);
    assignConfig(configForm, response.item);
    message.success('Sub2API 配置已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    configSaving.value = false;
  }
}

function stopDetection(): void {
  currentAbortController?.abort();
  currentAbortController = null;
  runLoading.value = false;
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
    const response = await api.startSub2ApiCheck(abortController.signal);
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
    appendLog({
      level: 'warning',
      message: `开始清除 ${candidates.length} 个 401 账号`
    });

    const result = await api.deleteSub2ApiAccounts({
      accountIds: candidates.map((item) => item.accountId)
    });

    applyUnauthorizedDeleteResult(result, candidates);

    if (result.deleted > 0) {
      message.success(`401 账号清理完成：成功删除 ${result.deleted}/${result.total} 个`);
      return;
    }

    message.warning('没有 401 账号被删除');
  } catch (error) {
    handleApiError(error);
  } finally {
    deleteLoading.value = false;
  }
}

function applyUnauthorizedDeleteResult(
  result: Sub2ApiDeleteAccountsResponse,
  candidates: Sub2ApiDetectedIssueItem[]
): void {
  const candidateMap = new Map<number, Sub2ApiDetectedIssueItem>(
    candidates.map((item) => [item.accountId, item])
  );
  const deletedIds = new Set<number>();

  for (const detail of result.details) {
    const candidate = candidateMap.get(detail.accountId);
    const label = resolveIssueLabel({
      accountId: detail.accountId,
      accountName: candidate?.accountName ?? null
    });

    appendLog({
      level: detail.ok ? 'success' : 'warning',
      message: detail.ok
        ? `[${label}] 删除完成：${detail.message}`
        : `[${label}] 删除失败：${detail.message}`,
      accountId: detail.accountId,
      accountName: candidate?.accountName ?? null
    });

    if (detail.ok) {
      deletedIds.add(detail.accountId);
    }
  }

  if (deletedIds.size > 0) {
    unauthorizedCandidates.value = unauthorizedCandidates.value.filter(
      (item) => !deletedIds.has(item.accountId)
    );
    summary.totalAccounts = Math.max(0, summary.totalAccounts - deletedIds.size);
    summary.processedAccounts = Math.min(summary.processedAccounts, summary.totalAccounts);
    summary.unauthorizedAccounts = Math.max(0, summary.unauthorizedAccounts - deletedIds.size);
    progress.totalAccounts = summary.totalAccounts;
    progress.processedAccounts = Math.min(progress.processedAccounts, progress.totalAccounts);
  }

  appendLog({
    level: result.skipped > 0 ? 'warning' : 'success',
    message:
      result.skipped > 0
        ? `401 清理完成：成功删除 ${result.deleted}/${result.total} 个，剩余 ${result.skipped} 个未删除`
        : `401 清理完成：成功删除 ${result.deleted}/${result.total} 个`
  });
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
    runLoading,
    deleteLoading,
    storedConfig,
    configForm,
    summary,
    progress,
    logs,
    unauthorizedCandidates,
    abnormalCandidates,
    modelId: SUB2API_MODEL_ID,
    hasConfiguredSub2Api,
    hasUnauthorizedCandidates,
    loadConfig,
    loadInitialData,
    saveConfig,
    clearLogs,
    startDetection,
    clearUnauthorizedAccounts,
    stopDetection
  };
}
