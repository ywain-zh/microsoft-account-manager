import { computed, reactive, ref } from 'vue';
import { createDiscreteApi } from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import type {
  PublicCheckinAccount,
  PublicCheckinAccountPayload,
  PublicCheckinBalanceResult,
  PublicCheckinBatchResult,
  PublicCheckinCredential,
  PublicCheckinCredentialType,
  PublicCheckinLogResponse,
  PublicCheckinModelProbeResponse,
  PublicCheckinRunResult,
  PublicCheckinSettings,
  PublicCheckinStats,
  PublicCheckinStatus
} from '../types';

const { message } = createDiscreteApi(['message']);

const accounts = ref<PublicCheckinAccount[]>([]);
const stats = reactive<PublicCheckinStats>({
  totalAccounts: 0,
  enabledAccounts: 0,
  todaySuccess: 0,
  todayReward: 0,
  sevenDay: []
});
const settings = reactive<PublicCheckinSettings>({
  checkinCron: '0 8 * * *',
  checkinTime: '08:00',
  timezone: 'Asia/Shanghai',
  announcementPollingIntervalMinutes: 30
});
const logs = reactive<PublicCheckinLogResponse>({
  items: [],
  total: 0,
  limit: 50,
  offset: 0
});

const loading = ref(false);
const accountSaving = ref(false);
const settingsSaving = ref(false);
const busyAccountId = ref<number | null>(null);
const busyAccountAction = ref<'test' | 'models' | 'checkin' | 'balance' | 'delete' | 'auto-test' | null>(null);
const globalBusy = ref<'checkin' | 'balance' | null>(null);

const hasAccounts = computed(() => accounts.value.length > 0);

function assignStats(input: PublicCheckinStats): void {
  stats.totalAccounts = Number(input.totalAccounts || 0);
  stats.enabledAccounts = Number(input.enabledAccounts || 0);
  stats.todaySuccess = Number(input.todaySuccess || 0);
  stats.todayReward = Number(input.todayReward || 0);
  stats.sevenDay = Array.isArray(input.sevenDay) ? input.sevenDay : [];
}

function assignSettings(input: PublicCheckinSettings): void {
  settings.checkinCron = input.checkinCron || '0 8 * * *';
  settings.checkinTime = input.checkinTime || cronToTime(input.checkinCron) || '08:00';
  settings.timezone = input.timezone || 'Asia/Shanghai';
  settings.announcementPollingIntervalMinutes = input.announcementPollingIntervalMinutes || 30;
}

function cronToTime(value: string | undefined): string | null {
  const match = (value || '').trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!match) return null;
  return `${match[2].padStart(2, '0')}:${match[1].padStart(2, '0')}`;
}

function handleApiError(error: unknown): void {
  if (error instanceof UnauthorizedError) {
    message.warning('登录已过期，请重新登录');
    const redirect = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`);
    return;
  }
  message.error(error instanceof Error ? error.message : '操作失败');
}

function formatMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompactMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (Math.abs(value) < 100000) return formatMoney(value);
  return value.toLocaleString('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 2
  });
}

function formatTime(value: number | null | undefined): string {
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false });
}

function parseCredentialKey(key: string, platformUserId?: number): {
  credentialType: PublicCheckinCredentialType;
  credential: PublicCheckinCredential;
} {
  const value = key.trim();
  if (!value) {
    throw new Error('Key 不能为空');
  }

  if (value.startsWith('{')) {
    const parsed = JSON.parse(value) as { username?: string; password?: string };
    if (parsed.username && parsed.password) {
      return {
        credentialType: 'password',
        credential: {
          type: 'password',
          username: parsed.username,
          password: parsed.password
        }
      };
    }
  }

  if (/^cookie\s*:/im.test(value) || /(?:^|;\s*)(session|acw_tc|cdn_sec_tc|acw_sc__v2)=/i.test(value)) {
    return {
      credentialType: 'cookie',
      credential: {
        type: 'cookie',
        cookie: value,
        platformUserId
      }
    };
  }

  return {
    credentialType: 'access_token',
    credential: {
      type: 'access_token',
      accessToken: value,
      platformUserId
    }
  };
}

function buildPayload(input: {
  siteName: string;
  siteUrl: string;
  key: string;
  apiKey: string;
  platformUserId: string;
  checkinEnabled: boolean;
  useProxy: boolean;
  editing: boolean;
  currentCredentialType?: PublicCheckinCredentialType;
}): PublicCheckinAccountPayload {
  const siteName = input.siteName.trim();
  const siteUrl = input.siteUrl.trim();
  if (!siteName) throw new Error('站点名称不能为空');
  if (!siteUrl) throw new Error('站点 URL 不能为空');

  const key = input.key.trim();
  const shouldParseCredential = Boolean(key) || !input.editing;
  const parsed = shouldParseCredential
    ? parseCredentialKey(key, input.platformUserId.trim() ? Number(input.platformUserId.trim()) : undefined)
    : null;

  return {
    site: {
      name: siteName,
      url: siteUrl,
      platform: 'new-api'
    },
    label: siteName,
    credentialType: parsed?.credentialType || input.currentCredentialType || 'access_token',
    credential: parsed?.credential || null,
    apiKey: input.apiKey.trim() || null,
    checkinEnabled: input.checkinEnabled,
    useProxy: input.useProxy
  };
}

function checkinNotice(result: PublicCheckinRunResult): string {
  if (result.status === 'skipped') return `签到已跳过：${result.errorMessage || result.rewardNote || '任务未执行'}`;
  if (!result.success || result.status === 'failed') return `签到失败：${result.errorMessage || '未知原因'}`;
  if (typeof result.reward === 'number' && result.reward > 0) return `签到成功，增加额度：${formatMoney(result.reward)}`;
  return result.rewardNote && result.rewardNote !== '签到成功' ? `签到成功：${result.rewardNote}` : '签到成功';
}

function balanceNotice(result: PublicCheckinBalanceResult, prefix: string): string {
  return result.success ? `${prefix}，当前余额：${formatMoney(result.balance)}` : `${prefix}失败：${result.errorMessage || '未知原因'}`;
}

function summarizeBatch(results: PublicCheckinBatchResult[], actionName: string): string {
  const failed = results.filter((item) => item.result ? item.result.status === 'failed' || !item.result.success : item.success === false);
  if (failed.length > 0) {
    const first = failed[0];
    return `${actionName}完成，失败 ${failed.length} 个：${first.result?.errorMessage || first.errorMessage || '未知原因'}`;
  }
  return `${actionName}成功，共 ${results.length} 个账号`;
}

async function loadAccounts(): Promise<void> {
  accounts.value = await api.listPublicCheckinAccounts();
}

async function loadStats(): Promise<void> {
  assignStats(await api.getPublicCheckinStats());
}

async function loadSettings(): Promise<void> {
  assignSettings(await api.getPublicCheckinSettings());
}

async function loadInitialData(): Promise<void> {
  loading.value = true;
  try {
    await Promise.all([loadAccounts(), loadStats(), loadSettings()]);
  } catch (error) {
    handleApiError(error);
  } finally {
    loading.value = false;
  }
}

async function reloadSummary(): Promise<void> {
  await Promise.all([loadAccounts(), loadStats()]);
}

async function saveAccount(payload: PublicCheckinAccountPayload, id?: number): Promise<boolean> {
  accountSaving.value = true;
  try {
    if (id) {
      await api.updatePublicCheckinAccount(id, payload);
      message.success('账号已更新');
      await reloadSummary();
    } else {
      const created = await api.createPublicCheckinAccount(payload);
      message.success('账号已添加，正在自动检测');
      await reloadSummary();
      void autoTestCreatedAccount(created.id);
    }
    return true;
  } catch (error) {
    handleApiError(error);
    return false;
  } finally {
    accountSaving.value = false;
  }
}

async function autoTestCreatedAccount(accountId: number): Promise<void> {
  busyAccountId.value = accountId;
  busyAccountAction.value = 'auto-test';
  try {
    const result = await api.testPublicCheckinAccount(accountId);
    (result.success ? message.success : message.error)(balanceNotice(result, '自动检测'));
  } catch (error) {
    handleApiError(error);
  } finally {
    try {
      await reloadSummary();
    } catch (error) {
      handleApiError(error);
    }
    if (busyAccountId.value === accountId) {
      busyAccountId.value = null;
    }
    if (busyAccountAction.value === 'auto-test') {
      busyAccountAction.value = null;
    }
  }
}

async function deleteAccount(id: number): Promise<void> {
  busyAccountId.value = id;
  busyAccountAction.value = 'delete';
  try {
    await api.deletePublicCheckinAccount(id);
    message.success('账号已删除');
    await reloadSummary();
  } catch (error) {
    handleApiError(error);
  } finally {
    busyAccountId.value = null;
    busyAccountAction.value = null;
  }
}

async function testAccount(accountId: number): Promise<void> {
  busyAccountId.value = accountId;
  busyAccountAction.value = 'test';
  try {
    const result = await api.testPublicCheckinAccount(accountId);
    (result.success ? message.success : message.error)(balanceNotice(result, '连接检测'));
    await reloadSummary();
  } catch (error) {
    handleApiError(error);
  } finally {
    busyAccountId.value = null;
    busyAccountAction.value = null;
  }
}

async function testAccountModels(accountId: number): Promise<PublicCheckinModelProbeResponse> {
  busyAccountId.value = accountId;
  busyAccountAction.value = 'models';
  try {
    return await api.testPublicCheckinModels(accountId);
  } finally {
    busyAccountId.value = null;
    busyAccountAction.value = null;
  }
}

async function runAccountCheckin(accountId: number): Promise<void> {
  busyAccountId.value = accountId;
  busyAccountAction.value = 'checkin';
  try {
    const result = await api.runPublicCheckinAccount(accountId);
    (result.success && result.status !== 'failed' ? message.success : message.error)(checkinNotice(result));
    await reloadSummary();
  } catch (error) {
    handleApiError(error);
  } finally {
    busyAccountId.value = null;
    busyAccountAction.value = null;
  }
}

async function refreshAccountBalance(accountId: number): Promise<void> {
  busyAccountId.value = accountId;
  busyAccountAction.value = 'balance';
  try {
    const result = await api.refreshPublicCheckinBalance(accountId);
    (result.success ? message.success : message.error)(balanceNotice(result, '余额刷新'));
    await reloadSummary();
  } catch (error) {
    handleApiError(error);
  } finally {
    busyAccountId.value = null;
    busyAccountAction.value = null;
  }
}

async function runAllCheckin(): Promise<void> {
  globalBusy.value = 'checkin';
  try {
    const results = await api.runAllPublicCheckin();
    message.success(summarizeBatch(results, '全部签到'));
    await reloadSummary();
  } catch (error) {
    handleApiError(error);
  } finally {
    globalBusy.value = null;
  }
}

async function refreshAllBalances(): Promise<void> {
  globalBusy.value = 'balance';
  try {
    const results = await api.refreshAllPublicCheckinBalances();
    message.success(summarizeBatch(results, '刷新全部余额'));
    await reloadSummary();
  } catch (error) {
    handleApiError(error);
  } finally {
    globalBusy.value = null;
  }
}

async function loadLogs(params: {
  accountId?: number;
  status?: PublicCheckinStatus | '';
  startAt?: number;
  endAt?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<void> {
  try {
    const response = await api.listPublicCheckinLogs(params);
    logs.items = response.items;
    logs.total = response.total;
    logs.limit = response.limit;
    logs.offset = response.offset;
  } catch (error) {
    handleApiError(error);
  }
}

async function saveSettings(payload: PublicCheckinSettings): Promise<boolean> {
  settingsSaving.value = true;
  try {
    assignSettings(await api.updatePublicCheckinSettings(payload));
    message.success('调度设置已保存');
    return true;
  } catch (error) {
    handleApiError(error);
    return false;
  } finally {
    settingsSaving.value = false;
  }
}

async function cleanupLogs(): Promise<void> {
  try {
    const result = await api.cleanupPublicCheckinLogs();
    message.success(`旧日志已清理：${result.deleted} 条`);
    await loadLogs();
  } catch (error) {
    handleApiError(error);
  }
}

export function usePublicCheckinConsole() {
  return {
    accounts,
    stats,
    settings,
    logs,
    loading,
    accountSaving,
    settingsSaving,
    busyAccountId,
    busyAccountAction,
    globalBusy,
    hasAccounts,
    formatMoney,
    formatCompactMoney,
    formatTime,
    buildPayload,
    loadInitialData,
    reloadSummary,
    loadLogs,
    saveAccount,
    deleteAccount,
    testAccount,
    testAccountModels,
    runAccountCheckin,
    refreshAccountBalance,
    runAllCheckin,
    refreshAllBalances,
    saveSettings,
    cleanupLogs,
    handleApiError
  };
}
