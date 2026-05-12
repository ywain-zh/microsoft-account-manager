import { computed, reactive, ref, watch } from 'vue';
import { createDiscreteApi } from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import { copyToClipboard } from '../utils/clipboard';
import { downloadBlob } from '../utils/download';
import type {
  AccountMailItem,
  CloudMailAccountItem,
  CloudMailAccountListResponse,
  CloudMailConfig,
  CloudMailCreatePayload,
  CloudMailMessagesResponse
} from '../types';

const { message } = createDiscreteApi(['message']);
const CLOUD_MAIL_SEARCH_STORAGE_KEY = 'mail-console-cloud-mail-search';
const CLOUD_MAIL_CONFIG_CACHE_KEY = 'mail-console-cloud-mail-config-cache';
const CLOUD_MAIL_ACCOUNTS_CACHE_PREFIX = 'mail-console-cloud-mail-accounts-cache:';
const CLOUD_MAIL_MESSAGES_CACHE_PREFIX = 'mail-console-cloud-mail-messages-cache:';
const CLOUD_MAIL_CONFIG_CACHE_TTL_MS = 10 * 60 * 1000;
const CLOUD_MAIL_ACCOUNTS_CACHE_TTL_MS = 2 * 60 * 1000;
const CLOUD_MAIL_MESSAGES_CACHE_TTL_MS = 2 * 60 * 1000;
const RANDOM_LOCAL_PART_NAMES = [
  'harper',
  'mason',
  'dylan',
  'nolan',
  'evelyn',
  'julian',
  'claire',
  'lucas',
  'stella',
  'owen',
  'avery',
  'hudson',
  'hazel',
  'wyatt',
  'lauren',
  'parker',
  'sawyer',
  'logan',
  'mila',
  'declan'
];

interface CloudMailConfigFormState {
  apiBaseUrl: string;
  adminEmail: string;
  adminPassword: string;
  availableDomainsText: string;
}

interface CloudMailRemarkFormState {
  userId: number;
  email: string;
  remark: string;
}

interface TimedCacheEntry<T> {
  savedAt: number;
  payload: T;
}

interface CloudMailAccountsQuery {
  page: number;
  pageSize: number;
  keyword: string;
}

function createDefaultCloudMailConfig(): CloudMailConfig {
  return {
    apiBaseUrl: '',
    adminEmail: '',
    adminPassword: '',
    availableDomains: []
  };
}

function createDefaultConfigForm(): CloudMailConfigFormState {
  return {
    apiBaseUrl: '',
    adminEmail: '',
    adminPassword: '',
    availableDomainsText: ''
  };
}

function createDefaultCreateForm(): CloudMailCreatePayload {
  return {
    localPart: '',
    domain: ''
  };
}

function createDefaultRemarkForm(): CloudMailRemarkFormState {
  return {
    userId: 0,
    email: '',
    remark: ''
  };
}

function readPersistedSearchKeyword(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.sessionStorage.getItem(CLOUD_MAIL_SEARCH_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

function persistSearchKeyword(value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const normalized = value.trim();
    if (normalized) {
      window.sessionStorage.setItem(CLOUD_MAIL_SEARCH_STORAGE_KEY, normalized);
      return;
    }

    window.sessionStorage.removeItem(CLOUD_MAIL_SEARCH_STORAGE_KEY);
  } catch {
    // Ignore storage failures so search keeps working in restricted browsers.
  }
}

function readSessionCache<T>(key: string, ttlMs: number): T | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<TimedCacheEntry<T>>;
    if (typeof parsed.savedAt !== 'number' || !('payload' in parsed)) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    if (Date.now() - parsed.savedAt > ttlMs) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return parsed.payload as T;
  } catch {
    return null;
  }
}

function writeSessionCache<T>(key: string, payload: T): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const entry: TimedCacheEntry<T> = {
      savedAt: Date.now(),
      payload
    };
    window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Cache writes are best-effort; data loading should not depend on browser storage.
  }
}

function removeSessionCacheByPrefix(prefix: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(prefix)) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}

function getAccountsCacheKey(query: CloudMailAccountsQuery): string {
  return `${CLOUD_MAIL_ACCOUNTS_CACHE_PREFIX}${encodeURIComponent(
    `${query.page}|${query.pageSize}|${query.keyword.trim().toLowerCase()}`
  )}`;
}

function getCurrentConfigSyncKey(): string {
  const apiBaseUrl = storedConfig.apiBaseUrl.trim().replace(/\/+$/, '').toLowerCase();
  const adminEmail = storedConfig.adminEmail.trim().toLowerCase();
  return apiBaseUrl && adminEmail ? `${apiBaseUrl}::${adminEmail}` : '';
}

function getMessagesCacheKey(email: string): string {
  return `${CLOUD_MAIL_MESSAGES_CACHE_PREFIX}${encodeURIComponent(email.trim().toLowerCase())}`;
}

function clearAccountsCache(): void {
  removeSessionCacheByPrefix(CLOUD_MAIL_ACCOUNTS_CACHE_PREFIX);
}

function clearMailMessagesCache(): void {
  removeSessionCacheByPrefix(CLOUD_MAIL_MESSAGES_CACHE_PREFIX);
}

const initialDataLoaded = ref(false);
const configLoaded = ref(false);

const tableLoading = ref(false);
const configSaving = ref(false);
const createLoading = ref(false);
const deleteLoading = ref(false);
const accountsSyncing = ref(false);
const backgroundSyncing = ref(false);
const mailLoading = ref(false);
const remarkSaving = ref(false);
const gptJsonExportLoading = ref(false);

const configVisible = ref(false);
const createVisible = ref(false);
const mailVisible = ref(false);
const remarkVisible = ref(false);
const serviceErrorMessage = ref('');

const searchKeyword = ref(readPersistedSearchKeyword());
const tablePage = ref(1);
const tablePageSize = ref(20);
const total = ref(0);
const checkedRowKeys = ref<number[]>([]);
const accounts = ref<CloudMailAccountItem[]>([]);
const mailAccount = ref('');
const mailItems = ref<AccountMailItem[]>([]);
const selectedMailId = ref('');

const storedConfig = reactive<CloudMailConfig>(createDefaultCloudMailConfig());
const configForm = reactive<CloudMailConfigFormState>(createDefaultConfigForm());
const createForm = reactive<CloudMailCreatePayload>(createDefaultCreateForm());
const remarkForm = reactive<CloudMailRemarkFormState>(createDefaultRemarkForm());
const lastSilentSyncKey = ref('');
const lastAccountsCacheEmpty = ref(false);

const hasConfiguredCloudMail = computed(() => {
  return Boolean(storedConfig.apiBaseUrl && storedConfig.adminEmail && storedConfig.adminPassword);
});

const availableDomains = computed(() => storedConfig.availableDomains);
const selectedMail = computed(() => {
  return mailItems.value.find((item) => item.id === selectedMailId.value) ?? null;
});

async function markMailAsRead(id: string): Promise<void> {
  const target = mailItems.value.find((item) => item.id === id);
  const account = mailAccount.value.trim();
  if (!target || target.isRead === true || !account) {
    return;
  }

  mailItems.value = mailItems.value.map((item) => {
    if (item.id !== id) {
      return item;
    }
    return {
      ...item,
      isRead: true
    };
  });
  cacheCurrentMailMessages();

  try {
    await api.markCloudMailMessageAsRead(account, id);
  } catch (error) {
    rememberCloudMailServiceError(error);
    handleApiError(error);
  }
}

let initialLoadPromise: Promise<void> | null = null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误';
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

function looksLikeCloudMailConfigIssue(messageText: string): boolean {
  return [
    'Cloud Mail 管理员',
    'Cloud Mail 公开接口',
    'Cloud Mail 服务连接失败',
    '请先完成 Cloud Mail 配置'
  ].some((keyword) => messageText.includes(keyword));
}

function rememberCloudMailServiceError(error: unknown): void {
  const text = getErrorMessage(error).trim();
  if (text && looksLikeCloudMailConfigIssue(text)) {
    serviceErrorMessage.value = text;
  }
}

function clearCloudMailServiceError(): void {
  serviceErrorMessage.value = '';
}

function assignConfig(target: CloudMailConfig, source: CloudMailConfig): void {
  target.apiBaseUrl = source.apiBaseUrl;
  target.adminEmail = source.adminEmail;
  target.adminPassword = source.adminPassword;
  target.availableDomains = [...source.availableDomains];
}

function fillConfigForm(source: CloudMailConfig): void {
  configForm.apiBaseUrl = source.apiBaseUrl;
  configForm.adminEmail = source.adminEmail;
  configForm.adminPassword = source.adminPassword;
  configForm.availableDomainsText = source.availableDomains.join('\n');
}

function resetConfigForm(): void {
  configForm.apiBaseUrl = '';
  configForm.adminEmail = '';
  configForm.adminPassword = '';
  configForm.availableDomainsText = '';
}

function resetRemarkForm(): void {
  remarkForm.userId = 0;
  remarkForm.email = '';
  remarkForm.remark = '';
}

function resetCreateForm(): void {
  createForm.localPart = '';
  createForm.domain =
    availableDomains.value.length === 1 ? availableDomains.value[0] : availableDomains.value[0] ?? '';
}

function fillRandomLocalPart(): void {
  const name = RANDOM_LOCAL_PART_NAMES[Math.floor(Math.random() * RANDOM_LOCAL_PART_NAMES.length)] ?? 'cloud';
  const digitsLength = Math.random() < 0.5 ? 2 : 3;
  const min = digitsLength === 2 ? 10 : 100;
  const max = digitsLength === 2 ? 99 : 999;
  const digits = Math.floor(Math.random() * (max - min + 1)) + min;
  createForm.localPart = `${name}${digits}`;
}

function normalizeDomainsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim().toLowerCase().replace(/^@+/, ''))
        .filter(Boolean)
    )
  );
}

function clearMailState(): void {
  mailVisible.value = false;
  mailLoading.value = false;
  mailAccount.value = '';
  mailItems.value = [];
  selectedMailId.value = '';
}

function clearTableState(): void {
  accounts.value = [];
  total.value = 0;
  checkedRowKeys.value = [];
  lastAccountsCacheEmpty.value = false;
}

function assignAccountsResponse(response: CloudMailAccountListResponse): void {
  accounts.value = response.items;
  total.value = response.total;
  checkedRowKeys.value = checkedRowKeys.value.filter((id) => response.items.some((item) => item.userId === id));
  lastAccountsCacheEmpty.value = Boolean(response.cacheEmpty);
}

function getCurrentAccountsQuery(): CloudMailAccountsQuery {
  return {
    page: tablePage.value,
    pageSize: tablePageSize.value,
    keyword: searchKeyword.value.trim()
  };
}

function cacheCurrentAccounts(): void {
  writeSessionCache<CloudMailAccountListResponse>(getAccountsCacheKey(getCurrentAccountsQuery()), {
    items: accounts.value,
    total: total.value,
    page: tablePage.value,
    pageSize: tablePageSize.value,
    cacheEmpty: lastAccountsCacheEmpty.value
  });
}

function assignMailMessagesResponse(response: CloudMailMessagesResponse): void {
  mailAccount.value = response.account;
  mailItems.value = response.messages;
  selectedMailId.value = response.messages[0]?.id ?? '';
}

function cacheCurrentMailMessages(): void {
  const account = mailAccount.value.trim();
  if (!account) {
    return;
  }

  writeSessionCache<CloudMailMessagesResponse>(getMessagesCacheKey(account), {
    account,
    messages: mailItems.value
  });
}

async function loadConfig(options: { force?: boolean; preferCache?: boolean } = {}): Promise<void> {
  if (!options.force && options.preferCache) {
    const cached = readSessionCache<CloudMailConfig>(CLOUD_MAIL_CONFIG_CACHE_KEY, CLOUD_MAIL_CONFIG_CACHE_TTL_MS);
    if (cached) {
      assignConfig(storedConfig, cached);
      configLoaded.value = true;
      return;
    }
  }

  try {
    const response = await api.getCloudMailConfig();
    assignConfig(storedConfig, response.item);
    configLoaded.value = true;
    writeSessionCache(CLOUD_MAIL_CONFIG_CACHE_KEY, response.item);
  } catch (error) {
    handleApiError(error);
  }
}

async function loadAccounts(
  options: {
    resetPage?: boolean;
    force?: boolean;
    preferCache?: boolean;
    showLoading?: boolean;
    keepOnError?: boolean;
  } = {}
): Promise<void> {
  if (options.resetPage) {
    tablePage.value = 1;
  }

  if (!hasConfiguredCloudMail.value) {
    clearTableState();
    clearMailState();
    return;
  }

  const query = getCurrentAccountsQuery();
  if (!options.force && options.preferCache) {
    const cached = readSessionCache<CloudMailAccountListResponse>(
      getAccountsCacheKey(query),
      CLOUD_MAIL_ACCOUNTS_CACHE_TTL_MS
    );
    if (cached) {
      assignAccountsResponse(cached);
      clearCloudMailServiceError();
      return;
    }
  }

  const shouldShowLoading = options.showLoading ?? accounts.value.length === 0;
  if (shouldShowLoading) {
    tableLoading.value = true;
  }
  try {
    const response = await api.listCloudMailAccounts(query);
    assignAccountsResponse(response);
    writeSessionCache(getAccountsCacheKey(query), response);
    clearCloudMailServiceError();
  } catch (error) {
    if (options.keepOnError === false) {
      clearTableState();
    }
    rememberCloudMailServiceError(error);
    handleApiError(error);
  } finally {
    if (shouldShowLoading) {
      tableLoading.value = false;
    }
  }
}

async function syncAccounts(options: { silent?: boolean; reload?: boolean } = {}): Promise<void> {
  if (!hasConfiguredCloudMail.value) {
    return;
  }

  const loadingRef = options.silent ? backgroundSyncing : accountsSyncing;
  if (loadingRef.value) {
    return;
  }

  loadingRef.value = true;
  try {
    const response = await api.syncCloudMailAccounts();
    clearAccountsCache();
    clearCloudMailServiceError();
    if (options.reload !== false) {
      await loadAccounts({ force: true, showLoading: false, keepOnError: true });
    }
    if (!options.silent) {
      message.success(`Cloud Mail 邮箱列表已同步：${response.synced} 个`);
    }
  } catch (error) {
    rememberCloudMailServiceError(error);
    if (!options.silent) {
      handleApiError(error);
    }
  } finally {
    loadingRef.value = false;
  }
}

async function loadInitialData(force = false): Promise<void> {
  if (initialDataLoaded.value && !force) {
    return;
  }

  if (initialLoadPromise && !force) {
    return initialLoadPromise;
  }

  initialLoadPromise = (async () => {
    await loadConfig({ force, preferCache: true });
    if (hasConfiguredCloudMail.value) {
      await loadAccounts({ force, preferCache: true, keepOnError: true });
      const syncKey = getCurrentConfigSyncKey();
      if (syncKey && total.value > 0 && !lastAccountsCacheEmpty.value && lastSilentSyncKey.value !== syncKey) {
        lastSilentSyncKey.value = syncKey;
        void syncAccounts({ silent: true, reload: true });
      }
    } else {
      clearTableState();
      clearMailState();
    }
    initialDataLoaded.value = true;
  })();

  try {
    await initialLoadPromise;
  } finally {
    initialLoadPromise = null;
  }
}

function openConfigModal(): void {
  if (hasConfiguredCloudMail.value) {
    fillConfigForm(storedConfig);
  } else {
    resetConfigForm();
  }
  configVisible.value = true;
}

async function saveConfig(): Promise<void> {
  const payload: CloudMailConfig = {
    apiBaseUrl: configForm.apiBaseUrl.trim(),
    adminEmail: configForm.adminEmail.trim(),
    adminPassword: configForm.adminPassword.trim(),
    availableDomains: normalizeDomainsInput(configForm.availableDomainsText)
  };

  if (!payload.apiBaseUrl || !payload.adminEmail || !payload.adminPassword) {
    message.warning('请完整填写 API URI、管理员邮箱和管理员密码');
    return;
  }

  configSaving.value = true;
  try {
    const response = await api.updateCloudMailConfig(payload);
    assignConfig(storedConfig, response.item);
    fillConfigForm(response.item);
    writeSessionCache(CLOUD_MAIL_CONFIG_CACHE_KEY, response.item);
    clearAccountsCache();
    clearMailMessagesCache();
    lastSilentSyncKey.value = '';
    clearCloudMailServiceError();
    configVisible.value = false;
    message.success('Cloud Mail 配置信息已保存');
    await loadAccounts({ resetPage: true, force: true, keepOnError: false });
  } catch (error) {
    rememberCloudMailServiceError(error);
    handleApiError(error);
  } finally {
    configSaving.value = false;
  }
}

function openCreateModal(): void {
  if (!hasConfiguredCloudMail.value) {
    message.warning('请先完成 Cloud Mail 配置');
    return;
  }

  if (availableDomains.value.length === 0) {
    message.warning('请先配置至少一个可用域名');
    return;
  }

  if (serviceErrorMessage.value) {
    message.warning('当前 Cloud Mail 配置不可用，请先重新保存配置信息');
    openConfigModal();
    return;
  }

  resetCreateForm();
  createVisible.value = true;
}

async function createAccount(): Promise<void> {
  const payload: CloudMailCreatePayload = {
    localPart: createForm.localPart.trim(),
    domain: createForm.domain.trim().toLowerCase()
  };

  if (!payload.localPart || !payload.domain) {
    message.warning('请完整填写邮箱前缀并选择域名');
    return;
  }

  createLoading.value = true;
  try {
    await api.createCloudMailAccount(payload);
    clearAccountsCache();
    clearCloudMailServiceError();
    createVisible.value = false;
    resetCreateForm();
    message.success('Cloud Mail 邮箱已新增');
    await loadAccounts({ force: true, showLoading: false, keepOnError: true });
  } catch (error) {
    rememberCloudMailServiceError(error);
    handleApiError(error);
  } finally {
    createLoading.value = false;
  }
}

async function deleteAccounts(userIds: number[]): Promise<void> {
  if (userIds.length === 0) {
    message.warning('请至少选择一个 Cloud Mail 邮箱');
    return;
  }

  const confirmed = window.confirm(
    userIds.length === 1 ? '确认删除该 Cloud Mail 邮箱？' : `确认删除选中的 ${userIds.length} 个 Cloud Mail 邮箱？`
  );
  if (!confirmed) {
    return;
  }

  deleteLoading.value = true;
  try {
    await api.deleteCloudMailAccounts({ userIds });
    clearAccountsCache();
    clearMailMessagesCache();
    clearCloudMailServiceError();
    message.success(`已删除 ${userIds.length} 个 Cloud Mail 邮箱`);
    checkedRowKeys.value = checkedRowKeys.value.filter((id) => !userIds.includes(id));
    await loadAccounts({ force: true, showLoading: false, keepOnError: true });
  } catch (error) {
    rememberCloudMailServiceError(error);
    handleApiError(error);
  } finally {
    deleteLoading.value = false;
  }
}

async function deleteSelectedAccounts(): Promise<void> {
  await deleteAccounts([...checkedRowKeys.value]);
}

async function deleteSingleAccount(row: CloudMailAccountItem): Promise<void> {
  await deleteAccounts([row.userId]);
}

async function refreshAccounts(): Promise<void> {
  if (!hasConfiguredCloudMail.value) {
    message.warning('请先完成 Cloud Mail 配置');
    return;
  }

  if (serviceErrorMessage.value) {
    message.warning('当前 Cloud Mail 配置不可用，请先重新保存配置信息');
    openConfigModal();
    return;
  }

  await syncAccounts({ reload: true });
}

function openRemarkModal(row: CloudMailAccountItem): void {
  remarkForm.userId = row.userId;
  remarkForm.email = row.email;
  remarkForm.remark = row.remark ?? '';
  remarkVisible.value = true;
}

function closeRemarkModal(): void {
  remarkVisible.value = false;
  resetRemarkForm();
}

async function saveRemark(): Promise<void> {
  if (!remarkForm.userId) {
    message.warning('请先选择需要备注的邮箱');
    return;
  }

  remarkSaving.value = true;
  try {
    const response = await api.updateCloudMailRemark(remarkForm.userId, remarkForm.remark);
    accounts.value = accounts.value.map((item) =>
      item.userId === response.item.userId ? response.item : item
    );
    cacheCurrentAccounts();
    remarkVisible.value = false;
    resetRemarkForm();
    clearCloudMailServiceError();
    message.success('备注已保存');
  } catch (error) {
    rememberCloudMailServiceError(error);
    handleApiError(error);
  } finally {
    remarkSaving.value = false;
  }
}

async function handleSearch(): Promise<void> {
  tablePage.value = 1;
  await loadAccounts();
}

async function handlePageChange(page: number): Promise<void> {
  tablePage.value = page;
  await loadAccounts();
}

async function handlePageSizeChange(pageSize: number): Promise<void> {
  tablePageSize.value = pageSize;
  tablePage.value = 1;
  await loadAccounts();
}

function handleCheckedRowKeysUpdate(keys: Array<string | number>): void {
  checkedRowKeys.value = keys
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function copyText(value: string, successMessage: string): Promise<boolean> {
  const text = value.trim();
  if (!text) {
    message.warning('当前没有可复制的内容');
    return false;
  }

  try {
    const copied = await copyToClipboard(text);
    if (!copied) {
      message.error('复制失败，请检查浏览器权限');
      return false;
    }

    message.success(successMessage);
    return true;
  } catch {
    message.error('复制失败，请检查浏览器权限');
    return false;
  }
}

async function copyEmail(email: string): Promise<boolean> {
  return copyText(email, '邮箱已复制');
}

async function copyMailAccount(): Promise<boolean> {
  if (!mailAccount.value.trim()) {
    message.warning('请先打开一个邮箱收件箱');
    return false;
  }

  return copyText(mailAccount.value, '邮箱已复制');
}

async function loadMailMessages(
  email: string,
  openModal = true,
  options: { force?: boolean; preferCache?: boolean } = {}
): Promise<void> {
  const targetEmail = email.trim();
  if (!targetEmail) {
    message.warning('当前邮箱不能为空');
    return;
  }

  if (openModal) {
    mailVisible.value = true;
  }

  const cacheKey = getMessagesCacheKey(targetEmail);
  if (!options.force && options.preferCache) {
    const cached = readSessionCache<CloudMailMessagesResponse>(
      cacheKey,
      CLOUD_MAIL_MESSAGES_CACHE_TTL_MS
    );
    if (cached) {
      assignMailMessagesResponse(cached);
      mailLoading.value = false;
      clearCloudMailServiceError();
      return;
    }
  }

  mailLoading.value = true;
  const previousEmail = mailAccount.value.trim().toLowerCase();
  mailAccount.value = targetEmail;
  if (previousEmail !== targetEmail.toLowerCase()) {
    mailItems.value = [];
    selectedMailId.value = '';
  } else if (!options.force) {
    mailItems.value = [];
    selectedMailId.value = '';
  }

  try {
    const response = await api.getCloudMailMessages(targetEmail);
    assignMailMessagesResponse(response);
    writeSessionCache(cacheKey, response);
    clearCloudMailServiceError();
  } catch (error) {
    rememberCloudMailServiceError(error);
    handleApiError(error);
  } finally {
    mailLoading.value = false;
  }
}

async function openMailModal(row: CloudMailAccountItem): Promise<void> {
  if (!hasConfiguredCloudMail.value) {
    message.warning('请先完成 Cloud Mail 配置');
    return;
  }

  if (serviceErrorMessage.value) {
    message.warning('当前 Cloud Mail 配置不可用，请先重新保存配置信息');
    openConfigModal();
    return;
  }

  await loadMailMessages(row.email, true, { preferCache: true });
}

async function refreshMailInbox(): Promise<void> {
  if (!mailAccount.value.trim()) {
    message.warning('请先打开一个邮箱收件箱');
    return;
  }

  await loadMailMessages(mailAccount.value, false, { force: true });
}

async function exportSub2ApiGptJson(email: string): Promise<void> {
  const targetEmail = email.trim();
  if (!targetEmail || gptJsonExportLoading.value) {
    return;
  }

  gptJsonExportLoading.value = true;
  try {
    const { blob, filename } = await api.exportSub2ApiGptJson(targetEmail);
    downloadBlob(blob, filename);
    message.success('GPT JSON 已开始下载');
  } catch (error) {
    handleApiError(error);
  } finally {
    gptJsonExportLoading.value = false;
  }
}

function formatDate(value: string | null): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

watch(
  searchKeyword,
  (value) => {
    persistSearchKeyword(value);
  },
  { flush: 'sync' }
);

export function useCloudMailConsole() {
  return {
    initialDataLoaded,
    configLoaded,
    tableLoading,
    configSaving,
    createLoading,
    deleteLoading,
    accountsSyncing,
    backgroundSyncing,
    mailLoading,
    remarkSaving,
    gptJsonExportLoading,
    configVisible,
    createVisible,
    mailVisible,
    remarkVisible,
    serviceErrorMessage,
    searchKeyword,
    tablePage,
    tablePageSize,
    total,
    checkedRowKeys,
    accounts,
    mailAccount,
    mailItems,
    selectedMailId,
    selectedMail,
    storedConfig,
    configForm,
    createForm,
    remarkForm,
    hasConfiguredCloudMail,
    availableDomains,
    loadConfig,
    loadAccounts,
    loadInitialData,
    openConfigModal,
    saveConfig,
    openCreateModal,
    fillRandomLocalPart,
    createAccount,
    deleteSelectedAccounts,
    deleteSingleAccount,
    refreshAccounts,
    openRemarkModal,
    closeRemarkModal,
    saveRemark,
    handleSearch,
    handlePageChange,
    handlePageSizeChange,
    handleCheckedRowKeysUpdate,
    copyEmail,
    copyMailAccount,
    openMailModal,
    refreshMailInbox,
    exportSub2ApiGptJson,
    formatDate,
    clearMailState,
    markMailAsRead
  };
}
