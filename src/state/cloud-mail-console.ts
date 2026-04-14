import { computed, reactive, ref, watch } from 'vue';
import { createDiscreteApi } from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import type {
  AccountMailItem,
  CloudMailAccountItem,
  CloudMailConfig,
  CloudMailCreatePayload
} from '../types';

const { message } = createDiscreteApi(['message']);
const CLOUD_MAIL_SEARCH_STORAGE_KEY = 'mail-console-cloud-mail-search';
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

const initialDataLoaded = ref(false);
const configLoaded = ref(false);

const tableLoading = ref(false);
const configSaving = ref(false);
const createLoading = ref(false);
const deleteLoading = ref(false);
const mailLoading = ref(false);

const configVisible = ref(false);
const createVisible = ref(false);
const mailVisible = ref(false);
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

const hasConfiguredCloudMail = computed(() => {
  return Boolean(storedConfig.apiBaseUrl && storedConfig.adminEmail && storedConfig.adminPassword);
});

const availableDomains = computed(() => storedConfig.availableDomains);
const selectedMail = computed(() => {
  return mailItems.value.find((item) => item.id === selectedMailId.value) ?? null;
});
const selectedMailText = computed(() => {
  if (!selectedMail.value) {
    return '';
  }

  const content = selectedMail.value.content || selectedMail.value.preview || '';
  return selectedMail.value.contentType === 'html' ? htmlToText(content) : content;
});

let initialLoadPromise: Promise<void> | null = null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误';
}

function htmlToText(html: string): string {
  if (!html) {
    return '';
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').trim();
  } catch {
    return html;
  }
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
}

async function loadConfig(): Promise<void> {
  try {
    const response = await api.getCloudMailConfig();
    assignConfig(storedConfig, response.item);
    configLoaded.value = true;
  } catch (error) {
    handleApiError(error);
  }
}

async function loadAccounts(options: { resetPage?: boolean } = {}): Promise<void> {
  if (options.resetPage) {
    tablePage.value = 1;
  }

  if (!hasConfiguredCloudMail.value) {
    clearTableState();
    clearMailState();
    return;
  }

  tableLoading.value = true;
  try {
    const response = await api.listCloudMailAccounts({
      page: tablePage.value,
      pageSize: tablePageSize.value,
      keyword: searchKeyword.value.trim()
    });
    accounts.value = response.items;
    total.value = response.total;
    checkedRowKeys.value = checkedRowKeys.value.filter((id) => response.items.some((item) => item.userId === id));
    clearCloudMailServiceError();
  } catch (error) {
    clearTableState();
    rememberCloudMailServiceError(error);
    handleApiError(error);
  } finally {
    tableLoading.value = false;
  }
}

async function loadInitialData(force = false): Promise<void> {
  if (initialLoadPromise && !force) {
    return initialLoadPromise;
  }

  initialLoadPromise = (async () => {
    await loadConfig();
    if (hasConfiguredCloudMail.value) {
      await loadAccounts();
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
    clearCloudMailServiceError();
    configVisible.value = false;
    message.success('Cloud Mail 配置信息已保存');
    await loadAccounts({ resetPage: true });
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
    clearCloudMailServiceError();
    createVisible.value = false;
    resetCreateForm();
    message.success('Cloud Mail 邮箱已新增');
    await loadAccounts();
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
    clearCloudMailServiceError();
    message.success(`已删除 ${userIds.length} 个 Cloud Mail 邮箱`);
    checkedRowKeys.value = checkedRowKeys.value.filter((id) => !userIds.includes(id));
    await loadAccounts();
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

  await loadAccounts();
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

async function copyText(value: string, successMessage: string): Promise<void> {
  const text = value.trim();
  if (!text) {
    message.warning('当前没有可复制的内容');
    return;
  }

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    message.warning('当前环境不支持复制到剪贴板');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    message.success(successMessage);
  } catch {
    message.error('复制失败，请检查浏览器权限');
  }
}

async function copyEmail(email: string): Promise<void> {
  await copyText(email, '邮箱已复制');
}

async function copyMailAccount(): Promise<void> {
  if (!mailAccount.value.trim()) {
    message.warning('请先打开一个邮箱收件箱');
    return;
  }

  await copyText(mailAccount.value, '邮箱已复制');
}

async function loadMailMessages(email: string, openModal = true): Promise<void> {
  const targetEmail = email.trim();
  if (!targetEmail) {
    message.warning('当前邮箱不能为空');
    return;
  }

  if (openModal) {
    mailVisible.value = true;
  }
  mailLoading.value = true;
  mailAccount.value = targetEmail;
  mailItems.value = [];
  selectedMailId.value = '';

  try {
    const response = await api.getCloudMailMessages(targetEmail);
    mailAccount.value = response.account;
    mailItems.value = response.messages;
    selectedMailId.value = response.messages[0]?.id ?? '';
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

  await loadMailMessages(row.email, true);
}

async function refreshMailInbox(): Promise<void> {
  if (!mailAccount.value.trim()) {
    message.warning('请先打开一个邮箱收件箱');
    return;
  }

  await loadMailMessages(mailAccount.value, false);
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
    mailLoading,
    configVisible,
    createVisible,
    mailVisible,
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
    selectedMailText,
    storedConfig,
    configForm,
    createForm,
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
    handleSearch,
    handlePageChange,
    handlePageSizeChange,
    handleCheckedRowKeysUpdate,
    copyEmail,
    copyMailAccount,
    openMailModal,
    refreshMailInbox,
    formatDate,
    clearMailState
  };
}
