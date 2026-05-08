import { computed, reactive, ref, watch } from 'vue';
import { createDiscreteApi } from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import { copyToClipboard } from '../utils/clipboard';
import type {
  AccountItem,
  AccountMailItem,
  AccountPayload,
  BatchActionResult,
  IngestConfig,
  MailFetchMode,
  TokenStatus
} from '../types';

const { message } = createDiscreteApi(['message']);
const ADMIN_MAIL_FETCH_MODE: MailFetchMode = 'auto';
const ACCOUNT_SEARCH_STORAGE_KEY = 'mail-console-account-search';
const MICROSOFT_OAUTH_LOGIN_PATH = '/auth/microsoft';
const MICROSOFT_OAUTH_POPUP_NAME = 'microsoft-oauth-login';
const MICROSOFT_OAUTH_POPUP_FEATURES = 'popup=yes,width=560,height=760,left=120,top=80,resizable=yes,scrollbars=yes';

interface AccountFormState {
  account: string;
  password: string;
  clientId: string;
  refreshToken: string;
}

interface AccountRemarkFormState {
  id: number | null;
  account: string;
  remark: string;
}

interface MicrosoftOauthResultPayload {
  source?: string;
  ok?: boolean;
  message?: string;
  account?: string;
}

const authChecked = ref(false);
const initialDataLoaded = ref(false);
const authLoading = ref(false);
const loginLoading = ref(false);
const logoutLoading = ref(false);
const isAuthenticated = ref(false);
const currentUser = ref('');
const siteOrigin = ref(typeof window === 'undefined' ? '' : window.location.origin);
const oauthPopupLoading = ref(false);

const accounts = ref<AccountItem[]>([]);
const searchKeyword = ref(readPersistedSearchKeyword());
const checkedRowKeys = ref<number[]>([]);
const tablePageSize = ref(20);

const tableLoading = ref(false);
const createLoading = ref(false);
const editLoading = ref(false);
const importLoading = ref(false);
const remarkSaving = ref(false);
const saveIngestLoading = ref(false);
const syncLoading = ref(false);
const batchDeleteLoading = ref(false);

const createVisible = ref(false);
const importVisible = ref(false);
const editVisible = ref(false);
const remarkVisible = ref(false);
const mailVisible = ref(false);
const mailLoading = ref(false);

const mailAccountId = ref<number | null>(null);
const mailAccount = ref('');
const mailItems = ref<AccountMailItem[]>([]);
const selectedMailId = ref('');

const importText = ref('');

const createForm = reactive<AccountFormState>({
  account: '',
  password: '',
  clientId: '',
  refreshToken: ''
});

const editForm = reactive<AccountFormState & { id: number | null }>({
  id: null,
  account: '',
  password: '',
  clientId: '',
  refreshToken: ''
});

const remarkForm = reactive<AccountRemarkFormState>({
  id: null,
  account: '',
  remark: ''
});

const ingestConfig = reactive<IngestConfig>({
  delimiter: '----',
  captchaField: 'data',
  accountField: 'a',
  passwordField: 'p',
  clientIdField: 'c',
  tokenField: 't'
});

const ingestEndpointPath = ref('/api/upload/ingest');
const ingestTokenHeader = ref('x-ingest-token');
const mailApiTokenHeader = ref('x-mail-api-token');

const selectedMail = computed(() => {
  return mailItems.value.find((item) => item.id === selectedMailId.value) ?? null;
});

function markMailAsRead(id: string): void {
  mailItems.value = mailItems.value.map((item) => {
    if (item.id !== id || item.isRead === true) {
      return item;
    }
    return {
      ...item,
      isRead: true
    };
  });
}

let authCheckPromise: Promise<boolean> | null = null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误';
}

function readPersistedSearchKeyword(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.sessionStorage.getItem(ACCOUNT_SEARCH_STORAGE_KEY)?.trim() ?? '';
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
      window.sessionStorage.setItem(ACCOUNT_SEARCH_STORAGE_KEY, normalized);
      return;
    }

    window.sessionStorage.removeItem(ACCOUNT_SEARCH_STORAGE_KEY);
  } catch {
    // Ignore storage failures so search keeps working in restricted browsers.
  }
}

function clearCreateForm(): void {
  createForm.account = '';
  createForm.password = '';
  createForm.clientId = '';
  createForm.refreshToken = '';
}

function clearImportForm(): void {
  importText.value = '';
}

function resetEditForm(): void {
  editForm.id = null;
  editForm.account = '';
  editForm.password = '';
  editForm.clientId = '';
  editForm.refreshToken = '';
}

function resetRemarkForm(): void {
  remarkForm.id = null;
  remarkForm.account = '';
  remarkForm.remark = '';
}

function clearSessionState(): void {
  authChecked.value = true;
  initialDataLoaded.value = false;
  isAuthenticated.value = false;
  currentUser.value = '';
  oauthPopupLoading.value = false;
  accounts.value = [];
  checkedRowKeys.value = [];
  createVisible.value = false;
  importVisible.value = false;
  editVisible.value = false;
  remarkVisible.value = false;
  mailVisible.value = false;
  mailLoading.value = false;
  mailAccountId.value = null;
  mailAccount.value = '';
  mailItems.value = [];
  selectedMailId.value = '';
  clearCreateForm();
  clearImportForm();
  resetEditForm();
  resetRemarkForm();
}

function handleApiError(error: unknown, showAuthWarning = true): void {
  if (error instanceof UnauthorizedError) {
    clearSessionState();
    if (showAuthWarning) {
      message.warning('登录已过期，请重新登录');
    }
    return;
  }

  message.error(getErrorMessage(error));
}

function normalizePayload(payload: AccountFormState): AccountPayload {
  return {
    account: payload.account.trim(),
    password: payload.password.trim(),
    clientId: payload.clientId.trim(),
    refreshToken: payload.refreshToken.trim()
  };
}

function getTargetAccountIds(all: boolean): number[] {
  return all ? [] : checkedRowKeys.value;
}

function showBatchResult(prefix: string, result: BatchActionResult): void {
  if (result.failure === 0) {
    message.success(`${prefix}完成：成功 ${result.success}/${result.total}`);
    return;
  }

  message.warning(`${prefix}完成：成功 ${result.success}，失败 ${result.failure}`);
}

async function loadAccounts(): Promise<boolean> {
  tableLoading.value = true;
  try {
    const response = await api.listAccounts(searchKeyword.value.trim());
    accounts.value = response.items;
    const available = new Set(response.items.map((item) => item.id));
    checkedRowKeys.value = checkedRowKeys.value.filter((id) => available.has(id));
    return true;
  } catch (error) {
    handleApiError(error);
    return false;
  } finally {
    tableLoading.value = false;
  }
}

async function loadIngestConfig(): Promise<void> {
  try {
    const response = await api.getIngestConfig();
    ingestConfig.delimiter = response.item.delimiter;
    ingestConfig.captchaField = response.item.captchaField;
    ingestConfig.accountField = response.item.accountField;
    ingestConfig.passwordField = response.item.passwordField;
    ingestConfig.clientIdField = response.item.clientIdField;
    ingestConfig.tokenField = response.item.tokenField;
    ingestEndpointPath.value = response.endpointPath;
    ingestTokenHeader.value = response.tokenHeader;
  } catch (error) {
    handleApiError(error);
  }
}

async function loadInitialData(force = false): Promise<void> {
  if (initialDataLoaded.value && !force) {
    return;
  }

  await Promise.all([loadAccounts(), loadIngestConfig()]);
  initialDataLoaded.value = isAuthenticated.value;
}

async function ensureAuthState(): Promise<boolean> {
  if (authChecked.value) {
    return isAuthenticated.value;
  }

  if (authCheckPromise) {
    return authCheckPromise;
  }

  authLoading.value = true;
  authCheckPromise = (async () => {
    try {
      const me = await api.getMe();
      isAuthenticated.value = true;
      currentUser.value = me.username;
      authChecked.value = true;
      await loadInitialData();
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        clearSessionState();
        return false;
      }

      message.error(getErrorMessage(error));
      authChecked.value = true;
      return false;
    } finally {
      authLoading.value = false;
      authCheckPromise = null;
    }
  })();

  return authCheckPromise;
}

async function login(payload: { username: string; password: string }): Promise<boolean> {
  const username = payload.username.trim();
  const password = payload.password;

  if (!username || !password) {
    message.warning('请填写用户名和密码');
    return false;
  }

  loginLoading.value = true;
  try {
    const response = await api.login({ username, password });
    isAuthenticated.value = true;
    authChecked.value = true;
    currentUser.value = response.username;
    await loadInitialData(true);
    message.success('登录成功');
    return true;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      message.error(error.message);
      return false;
    }

    message.error(getErrorMessage(error));
    return false;
  } finally {
    loginLoading.value = false;
  }
}

async function logout(): Promise<void> {
  logoutLoading.value = true;
  try {
    await api.logout();
    message.success('已退出登录');
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      message.error(getErrorMessage(error));
    }
  } finally {
    logoutLoading.value = false;
    clearSessionState();
  }
}

function openCreateModal(): void {
  clearCreateForm();
  createVisible.value = true;
}

function openImportModal(): void {
  clearImportForm();
  importVisible.value = true;
}

function openEditModal(row: AccountItem): void {
  editForm.id = row.id;
  editForm.account = row.account;
  editForm.password = row.password;
  editForm.clientId = row.clientId ?? '';
  editForm.refreshToken = row.refreshToken ?? '';
  editVisible.value = true;
}

function openRemarkModal(row: AccountItem): void {
  remarkForm.id = row.id;
  remarkForm.account = row.account;
  remarkForm.remark = row.remark ?? '';
  remarkVisible.value = true;
}

function closeRemarkModal(): void {
  remarkVisible.value = false;
  resetRemarkForm();
}

function handleCheckedRowKeysUpdate(keys: Array<number | string>): void {
  checkedRowKeys.value = keys
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function createAccount(): Promise<void> {
  const payload = normalizePayload(createForm);
  if (!payload.account || !payload.password) {
    message.warning('账号和密码必填');
    return;
  }

  createLoading.value = true;
  try {
    await api.createAccount(payload);
    createVisible.value = false;
    clearCreateForm();
    await loadAccounts();
    message.success('账号已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    createLoading.value = false;
  }
}

async function updateAccount(): Promise<void> {
  if (!editForm.id) {
    return;
  }

  const payload = normalizePayload(editForm);
  if (!payload.account || !payload.password) {
    message.warning('账号和密码必填');
    return;
  }

  editLoading.value = true;
  try {
    await api.updateAccount(editForm.id, payload);
    editVisible.value = false;
    resetEditForm();
    await loadAccounts();
    message.success('账号已更新');
  } catch (error) {
    handleApiError(error);
  } finally {
    editLoading.value = false;
  }
}

async function saveRemark(): Promise<void> {
  if (!remarkForm.id) {
    message.warning('请先选择需要备注的邮箱');
    return;
  }

  remarkSaving.value = true;
  try {
    const response = await api.updateAccountRemark(remarkForm.id, remarkForm.remark);
    accounts.value = accounts.value.map((item) => (item.id === response.item.id ? response.item : item));
    remarkVisible.value = false;
    resetRemarkForm();
    message.success('备注已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    remarkSaving.value = false;
  }
}

async function deleteAccount(id: number): Promise<void> {
  const confirmed = window.confirm('确认删除该账号？');
  if (!confirmed) {
    return;
  }

  try {
    await api.deleteAccount(id);
    await loadAccounts();
    message.success('账号已删除');
  } catch (error) {
    handleApiError(error);
  }
}

async function importAccountsText(rawText: string, sourceLabel: string): Promise<void> {
  const text = rawText.trim();
  if (!text) {
    message.warning(`${sourceLabel} 内容为空`);
    return;
  }

  importLoading.value = true;
  try {
    const result = await api.importAccounts(text);
    importVisible.value = false;
    clearImportForm();
    await loadAccounts();
    message.success(`${sourceLabel} 导入完成：新增 ${result.inserted}，跳过 ${result.skipped}`);
    if (result.errors.length > 0) {
      message.warning(`有 ${result.errors.length} 行格式错误，已跳过`);
    }
  } catch (error) {
    handleApiError(error);
  } finally {
    importLoading.value = false;
  }
}

async function refreshAccounts(all: boolean): Promise<void> {
  const accountIds = getTargetAccountIds(all);
  if (!all && accountIds.length === 0) {
    message.warning('请先勾选需要检测的邮箱');
    return;
  }

  syncLoading.value = true;
  try {
    const result = await api.refreshAccounts({
      accountIds: all ? undefined : accountIds
    });
    await loadAccounts();
    showBatchResult('检测', result);
  } catch (error) {
    handleApiError(error);
  } finally {
    syncLoading.value = false;
  }
}

function selectAll(): void {
  checkedRowKeys.value = accounts.value.map((item) => item.id);
  message.success(`已选中 ${checkedRowKeys.value.length} 条账号`);
}

function selectInverse(): void {
  const currentIds = new Set(checkedRowKeys.value);
  checkedRowKeys.value = accounts.value
    .map((item) => item.id)
    .filter((id) => !currentIds.has(id));
  message.success(`反选完成，已选中 ${checkedRowKeys.value.length} 条账号`);
}

async function batchDeleteAccounts(): Promise<void> {
  if (checkedRowKeys.value.length === 0) {
    message.warning('请先选择要删除的账号');
    return;
  }

  const confirmed = window.confirm(`确认删除选中的 ${checkedRowKeys.value.length} 条账号？此操作不可恢复！`);
  if (!confirmed) {
    return;
  }

  batchDeleteLoading.value = true;
  try {
    const result = await api.batchDeleteAccounts({
      accountIds: checkedRowKeys.value
    });
    await loadAccounts();
    if (result.deleted > 0) {
      message.success(`删除完成：成功删除 ${result.deleted}/${result.total} 条`);
      return;
    }

    message.warning('没有账号被删除');
  } catch (error) {
    handleApiError(error);
  } finally {
    batchDeleteLoading.value = false;
  }
}

async function loadMailMessages(id: number, accountLabel: string, openModal = true): Promise<void> {
  if (openModal) {
    mailVisible.value = true;
  }
  mailLoading.value = true;
  mailAccountId.value = id;
  mailAccount.value = accountLabel;
  mailItems.value = [];
  selectedMailId.value = '';

  try {
    const response = await api.getAccountMessages(id, ADMIN_MAIL_FETCH_MODE);
    mailAccountId.value = response.accountId;
    mailAccount.value = response.account;
    mailItems.value = response.messages;
    selectedMailId.value = response.messages[0]?.id ?? '';
    await loadAccounts();
  } catch (error) {
    handleApiError(error);
  } finally {
    mailLoading.value = false;
  }
}

async function openMailModal(row: AccountItem): Promise<void> {
  await loadMailMessages(row.id, row.account, true);
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

async function copyAccountValue(account: string): Promise<boolean> {
  return copyText(account, '邮箱已复制');
}

async function copyMailAccount(): Promise<boolean> {
  const account = mailAccount.value.trim();
  if (!account) {
    message.warning('当前没有可复制的邮箱');
    return false;
  }

  return copyText(account, '邮箱已复制');
}

async function refreshMailInbox(): Promise<void> {
  if (!mailAccountId.value) {
    message.warning('请先打开一个邮箱收件箱');
    return;
  }

  await loadMailMessages(mailAccountId.value, mailAccount.value, false);
}

async function saveIngestConfig(): Promise<void> {
  saveIngestLoading.value = true;
  try {
    const response = await api.updateIngestConfig({
      delimiter: ingestConfig.delimiter.trim(),
      captchaField: ingestConfig.captchaField.trim(),
      accountField: ingestConfig.accountField.trim(),
      passwordField: ingestConfig.passwordField.trim(),
      clientIdField: ingestConfig.clientIdField.trim(),
      tokenField: ingestConfig.tokenField.trim()
    });
    ingestConfig.delimiter = response.item.delimiter;
    ingestConfig.captchaField = response.item.captchaField;
    ingestConfig.accountField = response.item.accountField;
    ingestConfig.passwordField = response.item.passwordField;
    ingestConfig.clientIdField = response.item.clientIdField;
    ingestConfig.tokenField = response.item.tokenField;
    message.success('上传映射配置已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    saveIngestLoading.value = false;
  }
}

function beginMicrosoftOauthLogin(): void {
  if (typeof window === 'undefined' || oauthPopupLoading.value) {
    return;
  }

  oauthPopupLoading.value = true;
  const popup = window.open(
    `${MICROSOFT_OAUTH_LOGIN_PATH}?mode=popup`,
    MICROSOFT_OAUTH_POPUP_NAME,
    MICROSOFT_OAUTH_POPUP_FEATURES
  );

  if (popup) {
    popup.focus();
    return;
  }

  oauthPopupLoading.value = false;
  window.location.assign(MICROSOFT_OAUTH_LOGIN_PATH);
}

async function consumeMicrosoftOauthResult(
  payload: Record<string, unknown> | MicrosoftOauthResultPayload
): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  oauthPopupLoading.value = false;
  const isPopupMessage = payload.source === 'microsoft-oauth';
  const queryOauth = typeof (payload as Record<string, unknown>).oauth === 'string'
    ? ((payload as Record<string, unknown>).oauth as string).trim()
    : '';
  const oauth = isPopupMessage
    ? (payload.ok ? 'success' : 'error')
    : queryOauth;
  if (!oauth) {
    return;
  }

  const account = typeof payload.account === 'string' ? payload.account.trim() : '';
  const rawMessage = typeof payload.message === 'string' ? payload.message.trim() : '';

  if (oauth === 'success') {
    if (account) {
      searchKeyword.value = account;
    }

    const loaded = await loadAccounts();
    if (!loaded) {
      message.warning('OAuth 已完成，但列表刷新失败，请手动刷新一次');
      return;
    }

    if (account) {
      const matched = accounts.value.some(
        (item) => item.account.trim().toLowerCase() === account.toLowerCase()
      );
      if (!matched) {
        searchKeyword.value = '';
        const fallbackLoaded = await loadAccounts();
        if (!fallbackLoaded) {
          message.warning('OAuth 已完成，但列表刷新失败，请手动刷新一次');
          return;
        }
      }
    }

    message.success(account ? `OAuth 登录成功：${account}` : 'OAuth 登录成功');
    return;
  }

  message.error(rawMessage || 'OAuth 登录失败');
}

function handleMicrosoftOauthMessage(event: MessageEvent<MicrosoftOauthResultPayload>): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (event.origin !== window.location.origin) {
    return;
  }

  if (!event.data || event.data.source !== 'microsoft-oauth') {
    return;
  }

  void consumeMicrosoftOauthResult(event.data);
}

function resolveTokenStatusLabel(row: AccountItem): string {
  if (row.tokenStatus === 'valid') {
    return '有效';
  }
  if (row.tokenStatus === 'invalid') {
    return '失效';
  }
  return '未检测';
}

function resolveTokenStatusTone(
  status: TokenStatus
): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'valid') {
    return 'success';
  }
  if (status === 'invalid') {
    return 'error';
  }
  if (status === 'unknown') {
    return 'warning';
  }
  return 'default';
}

function resolveCountdownLabel(row: AccountItem): string {
  if (row.tokenStatus === 'invalid') {
    return '已失效';
  }
  if (typeof row.tokenCountdownDays === 'number') {
    return `剩余 ${row.tokenCountdownDays} 天`;
  }
  return '未知';
}

function resolveCountdownTone(row: AccountItem): 'success' | 'error' | 'warning' | 'default' {
  if (row.tokenStatus === 'invalid') {
    return 'error';
  }
  if (typeof row.tokenCountdownDays !== 'number') {
    return 'default';
  }
  if (row.tokenCountdownDays <= 7) {
    return 'warning';
  }
  return 'success';
}

function formatMailDate(value: string): string {
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

export function useAdminConsole() {
  return {
    authChecked,
    initialDataLoaded,
    authLoading,
    loginLoading,
    logoutLoading,
    isAuthenticated,
    currentUser,
    siteOrigin,
    oauthPopupLoading,
    accounts,
    searchKeyword,
    checkedRowKeys,
    tablePageSize,
    tableLoading,
    createLoading,
    editLoading,
    importLoading,
    remarkSaving,
    saveIngestLoading,
    syncLoading,
    batchDeleteLoading,
    createVisible,
    importVisible,
    editVisible,
    remarkVisible,
    mailVisible,
    mailLoading,
    mailAccountId,
    mailAccount,
    mailItems,
    selectedMailId,
    selectedMail,
    importText,
    createForm,
    editForm,
    remarkForm,
    ingestConfig,
    ingestEndpointPath,
    ingestTokenHeader,
    mailApiTokenHeader,
    ensureAuthState,
    login,
    logout,
    loadAccounts,
    loadIngestConfig,
    loadInitialData,
    openCreateModal,
    openImportModal,
    openEditModal,
    openRemarkModal,
    closeRemarkModal,
    handleCheckedRowKeysUpdate,
    createAccount,
    updateAccount,
    saveRemark,
    deleteAccount,
    importAccountsText,
    refreshAccounts,
    selectAll,
    selectInverse,
    batchDeleteAccounts,
    openMailModal,
    copyAccountValue,
    copyMailAccount,
    refreshMailInbox,
    saveIngestConfig,
    beginMicrosoftOauthLogin,
    consumeMicrosoftOauthResult,
    handleMicrosoftOauthMessage,
    resolveTokenStatusLabel,
    resolveTokenStatusTone,
    resolveCountdownLabel,
    resolveCountdownTone,
    formatMailDate,
    markMailAsRead
  };
}
