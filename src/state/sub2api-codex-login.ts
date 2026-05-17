import { computed, reactive, ref } from 'vue';
import { createDiscreteApi } from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import type {
  CodexLoginCommand,
  CodexLoginLogItem,
  CodexLoginLogLevel,
  CodexLoginLogStream,
  CodexLoginProgress,
  CodexLoginRunPayload,
  CodexLoginSummary,
  Sub2ApiCodexLoginConfig
} from '../types';

const { message } = createDiscreteApi(['message']);
const MAX_LOG_ITEMS = 1600;

function createDefaultConfig(): Sub2ApiCodexLoginConfig {
  return {
    projectPath: 'C:/Users/zhouyuan/Desktop/Project/OpenAi/reg_codex_login',
    mailProvider: 'skymail',
    mailDomain: '',
    emailUsernameLength: 10,
    mailPollIntervalSeconds: 1.5,
    skymailBaseUrl: 'https://mail.zanolab.com',
    skymailAdminEmail: '',
    skymailAdminPassword: '',
    gptmailBaseUrl: 'https://mail.chatgpt.org.uk',
    gptmailApiKey: '',
    gptmailDomain: '',
    smsProvider: 'herosms',
    heroSmsApiKey: '',
    fiveSimApiKey: '',
    fiveSimProduct: 'openai',
    fiveSimOperator: 'any',
    smsService: 'dr',
    smsCountry: '',
    smsMaxPrice: 1,
    smsMinPrice: 0.02,
    blockedCountries: [],
    proxyUrl: '',
    passwordRandomLength: 12,
    passwordSuffix: '!A1',
    passwordCharset: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    maxCaptchaAttempts: 5,
    sentinelHeadless: true,
    sentinelWaitSeconds: 90,
    sentinelCfExtraSeconds: 60,
    sentinelChannel: '',
    sentinelPersistentProfile: true,
    sentinelHeadedFallback: true,
    sentinelProfileDir: 'browser_profile',
    requestTimeoutSeconds: 20,
    emailPollSeconds: 120,
    pollIntervalSeconds: 3,
    tokenCacheTtlSeconds: 300,
    authBaseUrl: 'https://auth.openai.com',
    chatBaseUrl: 'https://chatgpt.com',
    chatWebClientId: 'app_X8zY6vW2pQ9tR3dE7nK1jL5gH',
    codexClientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    userAgentChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148.0.0.0 Safari/537.36',
    acceptLanguage: 'en-US,en;q=0.9'
  };
}

function createDefaultSummary(): CodexLoginSummary {
  return {
    startedAt: null,
    finishedAt: null,
    command: null,
    exitCode: null,
    registered: 0,
    loginSucceeded: 0,
    failed: 0,
    savedFiles: 0
  };
}

function createDefaultProgress(): CodexLoginProgress {
  return {
    running: false,
    currentStage: null,
    processed: 0,
    total: 0
  };
}

function createDefaultRunForm(): CodexLoginRunPayload {
  return {
    command: 'all',
    count: 1,
    workers: 3,
    phone: '',
    password: '',
    latest: undefined,
    force: false
  };
}

const initialDataLoaded = ref(false);
const configLoaded = ref(false);
const configSaving = ref(false);
const runLoading = ref(false);

const storedConfig = reactive<Sub2ApiCodexLoginConfig>(createDefaultConfig());
const configForm = reactive<Sub2ApiCodexLoginConfig>(createDefaultConfig());
const runForm = reactive<CodexLoginRunPayload>(createDefaultRunForm());
const summary = reactive<CodexLoginSummary>(createDefaultSummary());
const progress = reactive<CodexLoginProgress>(createDefaultProgress());
const logs = ref<CodexLoginLogItem[]>([]);

const hasConfiguredCodexLogin = computed(() => {
  if (!storedConfig.projectPath || !storedConfig.mailDomain) {
    return false;
  }

  const hasMailConfig = storedConfig.mailProvider === 'skymail'
    ? Boolean(storedConfig.skymailBaseUrl && storedConfig.skymailAdminEmail && storedConfig.skymailAdminPassword)
    : Boolean(storedConfig.gptmailBaseUrl && storedConfig.gptmailApiKey);
  const hasSmsConfig = storedConfig.smsProvider === 'herosms'
    ? Boolean(storedConfig.heroSmsApiKey)
    : Boolean(storedConfig.fiveSimApiKey);

  return hasMailConfig && hasSmsConfig && Boolean(storedConfig.authBaseUrl && storedConfig.chatBaseUrl);
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

function assignConfig(target: Sub2ApiCodexLoginConfig, source: Sub2ApiCodexLoginConfig): void {
  Object.assign(target, {
    ...source,
    blockedCountries: [...source.blockedCountries]
  });
}

function assignSummary(target: CodexLoginSummary, source: Partial<CodexLoginSummary>): void {
  target.startedAt = typeof source.startedAt === 'string' ? source.startedAt : target.startedAt;
  target.finishedAt = typeof source.finishedAt === 'string' ? source.finishedAt : target.finishedAt;
  target.command = normalizeCommand(source.command ?? target.command);
  target.exitCode = typeof source.exitCode === 'number' ? source.exitCode : source.exitCode === null ? null : target.exitCode;
  target.registered = Number(source.registered ?? target.registered);
  target.loginSucceeded = Number(source.loginSucceeded ?? target.loginSucceeded);
  target.failed = Number(source.failed ?? target.failed);
  target.savedFiles = Number(source.savedFiles ?? target.savedFiles);
}

function assignProgress(target: CodexLoginProgress, source: Partial<CodexLoginProgress>): void {
  target.running = source.running ?? target.running;
  target.currentStage = typeof source.currentStage === 'string' ? source.currentStage : source.currentStage === null ? null : target.currentStage;
  target.processed = Number(source.processed ?? target.processed);
  target.total = Number(source.total ?? target.total);
}

function normalizeCommand(value: unknown): CodexLoginCommand | null {
  return value === 'all' || value === 'register' || value === 'login' ? value : null;
}

function normalizeLogLevel(value: unknown): CodexLoginLogLevel {
  return value === 'success' || value === 'warning' || value === 'error' ? value : 'info';
}

function normalizeLogStream(value: unknown): CodexLoginLogStream {
  return value === 'stdout' || value === 'stderr' ? value : 'system';
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

function appendLog(payload: Partial<CodexLoginLogItem>): void {
  const item: CodexLoginLogItem = {
    id: String(payload.id ?? `${Date.now()}-${logs.value.length + 1}`),
    timestamp: typeof payload.timestamp === 'string' && payload.timestamp ? payload.timestamp : new Date().toISOString(),
    level: normalizeLogLevel(payload.level),
    stream: normalizeLogStream(payload.stream),
    message: typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : '收到一条日志'
  };

  const nextLogs = [...logs.value, item];
  logs.value = nextLogs.length > MAX_LOG_ITEMS ? nextLogs.slice(-MAX_LOG_ITEMS) : nextLogs;
}

async function loadConfig(): Promise<void> {
  try {
    const response = await api.getCodexLoginConfig();
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
  configSaving.value = true;
  try {
    const payload: Sub2ApiCodexLoginConfig = {
      ...configForm,
      projectPath: configForm.projectPath.trim(),
      mailDomain: configForm.mailDomain.trim(),
      skymailBaseUrl: configForm.skymailBaseUrl.trim(),
      skymailAdminEmail: configForm.skymailAdminEmail.trim(),
      skymailAdminPassword: configForm.skymailAdminPassword.trim(),
      gptmailBaseUrl: configForm.gptmailBaseUrl.trim(),
      gptmailApiKey: configForm.gptmailApiKey.trim(),
      gptmailDomain: configForm.gptmailDomain.trim(),
      heroSmsApiKey: configForm.heroSmsApiKey.trim(),
      fiveSimApiKey: configForm.fiveSimApiKey.trim(),
      proxyUrl: configForm.proxyUrl.trim(),
      blockedCountries: [...configForm.blockedCountries]
    };
    const response = await api.updateCodexLoginConfig(payload);
    assignConfig(storedConfig, response.item);
    assignConfig(configForm, response.item);
    message.success('Codex Login 配置已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    configSaving.value = false;
  }
}

function buildRunPayload(): CodexLoginRunPayload {
  if (runForm.command === 'all') {
    return {
      command: 'all',
      count: Number(runForm.count ?? 1),
      workers: Number(runForm.workers ?? 1)
    };
  }

  if (runForm.command === 'register') {
    return { command: 'register' };
  }

  return {
    command: 'login',
    phone: String(runForm.phone ?? '').trim(),
    password: String(runForm.password ?? '').trim(),
    latest: runForm.latest ? Number(runForm.latest) : undefined,
    force: runForm.force === true
  };
}

function stopRun(): void {
  currentAbortController?.abort();
  currentAbortController = null;
  runLoading.value = false;
  progress.running = false;
}

async function startRun(): Promise<void> {
  if (!hasConfiguredCodexLogin.value) {
    message.warning('请先保存有效的 Codex Login 配置');
    return;
  }

  if (runLoading.value) {
    return;
  }

  resetSummary();
  resetProgress();
  clearLogs();

  runLoading.value = true;
  const abortController = new AbortController();
  currentAbortController = abortController;

  try {
    const response = await api.startCodexLoginRun(buildRunPayload(), abortController.signal);
    await consumeEventStream(response);
    message.success('Codex Login 任务完成');
  } catch (error) {
    if (!isAbortError(error)) {
      handleApiError(error);
    }
  } finally {
    if (currentAbortController === abortController) {
      currentAbortController = null;
    }
    runLoading.value = false;
    progress.running = false;
  }
}

async function consumeEventStream(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Codex Login 日志流不可用');
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
      appendLog(payload as Partial<CodexLoginLogItem>);
    }
    return;
  }

  if (eventName === 'summary') {
    if (payload && typeof payload === 'object') {
      assignSummary(summary, payload as Partial<CodexLoginSummary>);
    }
    return;
  }

  if (eventName === 'progress') {
    if (payload && typeof payload === 'object') {
      assignProgress(progress, payload as Partial<CodexLoginProgress>);
    }
    return;
  }

  if (eventName === 'done') {
    if (payload && typeof payload === 'object' && 'summary' in payload) {
      const donePayload = payload as { summary?: Partial<CodexLoginSummary> };
      if (donePayload.summary) {
        assignSummary(summary, donePayload.summary);
      }
    }
    progress.running = false;
    return;
  }

  if (eventName === 'error') {
    const messageText = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message?: unknown }).message ?? 'Codex Login 任务失败')
      : 'Codex Login 任务失败';
    appendLog({
      level: 'error',
      stream: 'system',
      message: messageText
    });
    throw new Error(messageText);
  }

  if (payloadText) {
    appendLog({
      level: 'info',
      stream: 'system',
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

export function useSub2ApiCodexLogin() {
  return {
    initialDataLoaded,
    configLoaded,
    configSaving,
    runLoading,
    storedConfig,
    configForm,
    runForm,
    summary,
    progress,
    logs,
    hasConfiguredCodexLogin,
    loadConfig,
    loadInitialData,
    saveConfig,
    clearLogs,
    startRun,
    stopRun
  };
}
