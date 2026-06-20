<template>
  <div class="page-container public-checkin-page">
    <div class="stats-grid">
      <div class="stat-card stat-muted">
        <div class="stat-title">总账号数</div>
        <div class="stat-value">{{ stats.totalAccounts }}</div>
      </div>
      <div class="stat-card stat-blue">
        <div class="stat-title">启用签到</div>
        <div class="stat-value">{{ stats.enabledAccounts }}</div>
      </div>
      <div class="stat-card stat-green">
        <div class="stat-title">今日成功</div>
        <div class="stat-value">{{ stats.todaySuccess }}</div>
      </div>
      <div class="stat-card stat-orange">
        <div class="stat-title">今日奖励</div>
        <div class="stat-value">{{ formatMoney(stats.todayReward) }}</div>
      </div>
    </div>

    <section class="checkin-panel">
      <div class="panel-toolbar">
        <div class="toolbar-left">
          <n-button class="btn-add" type="primary" @click="openCreateModal">添加账号</n-button>
          <span class="toolbar-divider"></span>
          <n-button class="btn-checkin" type="success" :loading="globalBusy === 'checkin'" :disabled="!hasAccounts || Boolean(globalBusy)" @click="runAllCheckin">
            全部签到
          </n-button>
          <n-button class="btn-soft" :loading="globalBusy === 'balance'" :disabled="!hasAccounts || Boolean(globalBusy)" @click="refreshAllBalances">
            刷新全部余额
          </n-button>
        </div>
        <div class="toolbar-right">
          <n-button class="btn-outline" @click="openLogModal">签到日志</n-button>
          <n-button class="btn-outline" @click="openSettingsModal">调度设置</n-button>
        </div>
      </div>

      <div class="accounts-table-wrap">
        <table class="accounts-table">
          <colgroup>
            <col class="col-site">
            <col class="col-balance">
            <col class="col-switch">
            <col class="col-status">
            <col class="col-actions">
          </colgroup>
          <thead>
            <tr>
              <th>公益站</th>
              <th>余额</th>
              <th>自动签到</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5">
                <div class="table-empty">加载中...</div>
              </td>
            </tr>
            <tr v-else-if="!accounts.length">
              <td colspan="5">
                <div class="table-empty">暂无账号</div>
              </td>
            </tr>
            <template v-else>
              <tr v-for="account in pagedAccounts" :key="account.id">
                <td>
                  <a
                    class="account-site-link"
                    :href="account.site.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    :title="account.site.url"
                  >
                    {{ account.site.name }}
                  </a>
                </td>
                <td>
                  <div class="account-balance-cell">
                    <strong :title="formatMoney(account.balance)">{{ formatCompactMoney(account.balance) }}</strong>
                    <span :class="{ 'is-positive': Boolean(account.lastCheckinReward && account.lastCheckinReward > 0) }">
                      {{ formatSignedMoney(account.lastCheckinReward) }}
                    </span>
                  </div>
                </td>
                <td>
                  <n-switch
                    :value="account.checkinEnabled"
                    :loading="busyAccountId === account.id"
                    @update:value="() => void toggleCheckin(account)"
                  />
                </td>
                <td>
                  <div class="account-status-cell">
                    <n-tag :type="healthTagType(account.healthState)" size="small" :bordered="false">
                      {{ healthLabel(account.healthState) }}
                    </n-tag>
                    <span :class="account.healthState === 'normal' ? 'muted-small' : 'error-small'" :title="account.healthMessage || ''">
                      {{ account.healthMessage || '-' }}<span v-if="account.useProxy"> · 本地代理</span>
                    </span>
                  </div>
                </td>
                <td>
                  <div class="account-actions">
                    <n-button class="row-btn row-btn-blue" size="small" :loading="busyAccountId === account.id" @click="testAccount(account.id)">检测</n-button>
                    <n-button class="row-btn row-btn-green" size="small" :loading="busyAccountId === account.id" @click="runAccountCheckin(account.id)">签到</n-button>
                    <n-button class="row-btn row-btn-gray" size="small" :loading="busyAccountId === account.id" @click="refreshAccountBalance(account.id)">余额</n-button>
                    <n-button class="row-btn row-btn-gray" size="small" @click="openEditModal(account)">编辑</n-button>
                    <n-button class="row-btn row-btn-red" size="small" @click="confirmDelete(account)">删除</n-button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div class="accounts-pagination">
        <n-pagination :page="accountPage" :page-count="accountPageCount" @update:page="setAccountPage" />
      </div>
    </section>

    <n-modal v-model:show="accountModalVisible" preset="card" class="public-checkin-modal account-modal" :title="editingAccount ? '编辑账号' : '添加账号'" style="width: min(720px, 94vw); border-radius: 12px;">
      <n-form label-placement="top" class="account-form designed-form" autocomplete="off">
        <div class="form-grid">
          <n-form-item label="站点名称">
            <n-input v-model:value="accountForm.siteName" placeholder="例如：公益站 A" />
          </n-form-item>
          <n-form-item label="站点 URL">
            <n-input v-model:value="accountForm.siteUrl" placeholder="https://new-api.example.com" />
          </n-form-item>
        </div>

        <n-form-item :label="editingAccount ? 'Key（留空则不修改）' : 'Key'">
          <n-input
            v-model:value="accountForm.key"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 8 }"
            placeholder='Cookie: session=...; acw_tc=...
或 access_token
或 {"username":"username","password":"password"}'
          />
          <template #feedback>
            会自动识别 cookie、access_token、username/password，服务端加密保存。
          </template>
        </n-form-item>

        <n-form-item :label="editingAccount ? 'User ID / New-Api-User（修改 Key 时填写）' : 'User ID / New-Api-User'">
          <SecretInput
            v-model:value="accountForm.platformUserId"
            placeholder="可从浏览器 Network 请求头 New-Api-User 中复制"
            :input-props="{ inputmode: 'numeric', autocomplete: 'off' }"
          />
        </n-form-item>

        <div class="switch-row">
          <n-checkbox v-model:checked="accountForm.checkinEnabled">启用自动签到</n-checkbox>
          <n-checkbox v-model:checked="accountForm.useProxy">启用本地代理</n-checkbox>
        </div>
      </n-form>

      <template #footer>
        <div class="modal-footer">
          <n-button :loading="connectionTesting" @click="testFormConnection">检测连接</n-button>
          <div class="modal-footer-actions">
            <n-button @click="accountModalVisible = false">取消</n-button>
            <n-button type="primary" :loading="accountSaving" @click="submitAccount">保存</n-button>
          </div>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="logModalVisible" preset="card" class="public-checkin-modal log-modal" title="签到日志" style="width: min(1100px, 96vw); border-radius: 12px;">
      <div class="log-panel">
        <div class="log-filters">
          <n-select v-model:value="logFilters.accountId" clearable placeholder="全部账号" :options="accountOptions" />
          <n-select v-model:value="logFilters.status" clearable placeholder="全部状态" :options="statusOptions" />
          <n-date-picker v-model:value="logFilters.startDate" type="date" clearable placeholder="开始日期" />
          <n-date-picker v-model:value="logFilters.endDate" type="date" clearable placeholder="结束日期" />
          <n-button @click="resetLogFilters">重置</n-button>
        </div>
        <n-data-table
          :columns="logColumns"
          :data="logs.items"
          :bordered="false"
          :single-line="false"
          :pagination="false"
          class="log-table"
        />
        <div class="log-pagination">
          <span>共 {{ logs.total }} 条</span>
          <n-pagination :page="logPage" :page-count="logPageCount" @update:page="setLogPage" />
        </div>
      </div>
    </n-modal>

    <n-modal v-model:show="settingsModalVisible" preset="card" class="public-checkin-modal settings-modal" title="调度设置" style="width: min(560px, 94vw); border-radius: 12px;">
      <n-form label-placement="top" class="designed-form settings-form">
        <n-form-item label="每日签到时间">
          <n-time-picker
            v-model:formatted-value="settingsForm.checkinTime"
            format="HH:mm"
            value-format="HH:mm"
            clearable
            placeholder="请选择签到时间"
            style="width: 100%;"
          />
          <template #feedback>到点后执行自动签到；余额刷新保留为手动操作。</template>
        </n-form-item>
        <n-form-item label="时区">
          <n-select v-model:value="settingsForm.timezone" :options="timezoneOptions" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button type="error" ghost @click="cleanupLogs">清理 30 天前日志</n-button>
          <div class="modal-footer-actions">
            <n-button @click="settingsModalVisible = false">取消</n-button>
            <n-button type="primary" :loading="settingsSaving" @click="submitSettings">保存设置</n-button>
          </div>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NCheckbox,
  NDataTable,
  NDatePicker,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NPagination,
  NSelect,
  NSwitch,
  NTag,
  NTimePicker,
  createDiscreteApi,
  type DataTableColumns
} from 'naive-ui';
import SecretInput from '../components/SecretInput.vue';
import { api } from '../api';
import { usePublicCheckinConsole } from '../state/public-checkin-console';
import type {
  PublicCheckinAccount,
  PublicCheckinLog,
  PublicCheckinStatus,
  PublicCheckinSettings
} from '../types';

const { dialog, message } = createDiscreteApi(['dialog', 'message']);
const publicCheckin = usePublicCheckinConsole();
const {
  accounts,
  stats,
  settings,
  logs,
  loading,
  accountSaving,
  settingsSaving,
  busyAccountId,
  globalBusy,
  hasAccounts,
  formatMoney,
  formatCompactMoney,
  formatTime,
  buildPayload,
  loadInitialData,
  loadLogs,
  saveAccount,
  deleteAccount,
  toggleCheckin,
  testAccount,
  runAccountCheckin,
  refreshAccountBalance,
  runAllCheckin,
  refreshAllBalances,
  saveSettings,
  cleanupLogs,
  handleApiError
} = publicCheckin;

const accountModalVisible = ref(false);
const logModalVisible = ref(false);
const settingsModalVisible = ref(false);
const connectionTesting = ref(false);
const editingAccount = ref<PublicCheckinAccount | null>(null);
const accountPage = ref(1);
const accountPageSize = 12;
const logPage = ref(1);
const logPageSize = 50;

const accountForm = reactive({
  siteName: '',
  siteUrl: '',
  key: '',
  platformUserId: '',
  checkinEnabled: true,
  useProxy: true
});

const settingsForm = reactive<PublicCheckinSettings>({
  checkinCron: '0 8 * * *',
  checkinTime: '08:00',
  timezone: 'Asia/Shanghai'
});

const logFilters = reactive<{
  accountId: number | null;
  status: PublicCheckinStatus | null;
  startDate: number | null;
  endDate: number | null;
}>({
  accountId: null,
  status: null,
  startDate: null,
  endDate: null
});

const accountOptions = computed(() => accounts.value.map((account) => ({
  label: account.site.name,
  value: account.id
})));

const statusOptions = [
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failed' },
  { label: '跳过', value: 'skipped' }
];

const timezoneOptions = ['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London']
  .map((value) => ({ label: value, value }));

const accountPageCount = computed(() => Math.max(1, Math.ceil(accounts.value.length / accountPageSize)));
const pagedAccounts = computed(() => {
  if (accountPage.value > accountPageCount.value) accountPage.value = accountPageCount.value;
  const start = (accountPage.value - 1) * accountPageSize;
  return accounts.value.slice(start, start + accountPageSize);
});
const logPageCount = computed(() => Math.max(1, Math.ceil(logs.total / logPageSize)));

const logColumns: DataTableColumns<PublicCheckinLog> = [
  {
    title: '账号',
    key: 'account',
    minWidth: 190,
    render(row) {
      return h('div', [
        h('strong', row.accountLabel),
        h('div', { class: 'muted-small' }, row.siteName)
      ]);
    }
  },
  {
    title: '触发',
    key: 'triggeredBy',
    width: 90,
    render(row) {
      return row.triggeredBy === 'manual' ? '手动' : '定时';
    }
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row) {
      return h(NTag, { type: statusTagType(row.status), size: 'small', bordered: false }, { default: () => statusLabel(row.status) });
    }
  },
  {
    title: '奖励',
    key: 'reward',
    width: 120,
    render(row) {
      return formatMoney(row.reward);
    }
  },
  {
    title: '说明',
    key: 'message',
    minWidth: 260,
    render(row) {
      return row.rewardNote || row.errorMessage || '-';
    }
  },
  {
    title: '执行时间',
    key: 'executedAt',
    width: 180,
    render(row) {
      return formatTime(row.executedAt);
    }
  }
];

function healthLabel(value: string): string {
  if (value === 'normal') return '正常';
  if (value === 'abnormal') return '异常';
  if (value === 'failed') return '失败';
  return '未检测';
}

function healthTagType(value: string): 'success' | 'warning' | 'error' | 'default' {
  if (value === 'normal') return 'success';
  if (value === 'abnormal') return 'warning';
  if (value === 'failed') return 'error';
  return 'default';
}

function statusLabel(value: PublicCheckinStatus): string {
  if (value === 'success') return '成功';
  if (value === 'failed') return '失败';
  return '跳过';
}

function statusTagType(value: PublicCheckinStatus): 'success' | 'warning' | 'error' {
  if (value === 'success') return 'success';
  if (value === 'failed') return 'error';
  return 'warning';
}

function formatSignedMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '+0.00';
  const absolute = Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : '+'}${absolute}`;
}

function resetAccountForm(): void {
  accountForm.siteName = '';
  accountForm.siteUrl = '';
  accountForm.key = '';
  accountForm.platformUserId = '';
  accountForm.checkinEnabled = true;
  accountForm.useProxy = true;
}

function openCreateModal(): void {
  editingAccount.value = null;
  resetAccountForm();
  accountModalVisible.value = true;
}

async function openEditModal(row: PublicCheckinAccount): Promise<void> {
  editingAccount.value = row;
  accountForm.siteName = row.site.name;
  accountForm.siteUrl = row.site.url;
  accountForm.checkinEnabled = row.checkinEnabled;
  accountForm.useProxy = row.useProxy;
  accountForm.key = '';
  accountForm.platformUserId = '';
  accountModalVisible.value = true;
  try {
    const credential = await api.getPublicCheckinCredential(row.id);
    if (credential.credential.type === 'cookie') accountForm.key = credential.credential.cookie || '';
    if (credential.credential.type === 'access_token') accountForm.key = credential.credential.accessToken || '';
    if (credential.credential.type === 'password') {
      accountForm.key = JSON.stringify({
        username: credential.credential.username || '',
        password: credential.credential.password || ''
      });
    }
    accountForm.platformUserId = credential.credential.platformUserId ? String(credential.credential.platformUserId) : '';
  } catch (error) {
    handleApiError(error);
  }
}

async function submitAccount(): Promise<void> {
  try {
    const payload = buildPayload({
      ...accountForm,
      editing: Boolean(editingAccount.value),
      currentCredentialType: editingAccount.value?.credentialType
    });
    const ok = await saveAccount(payload, editingAccount.value?.id);
    if (ok) accountModalVisible.value = false;
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  }
}

async function testFormConnection(): Promise<void> {
  connectionTesting.value = true;
  try {
    const payload = buildPayload({
      ...accountForm,
      editing: false
    });
    const result = await api.testPublicCheckinConnection({
      site: payload.site,
      credentialType: payload.credentialType,
      credential: payload.credential,
      useProxy: payload.useProxy
    });
    (result.success ? message.success : message.error)(
      result.success ? `连接成功，余额：${formatMoney(result.balance)}` : `连接失败：${result.errorMessage || '未知原因'}`
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : '检测失败');
  } finally {
    connectionTesting.value = false;
  }
}

function confirmDelete(row: PublicCheckinAccount): void {
  dialog.warning({
    title: '删除账号',
    content: `确认删除公益站「${row.site.name}」？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      void deleteAccount(row.id);
    }
  });
}

async function openLogModal(): Promise<void> {
  logModalVisible.value = true;
  await refreshLogs();
}

function openSettingsModal(): void {
  settingsForm.checkinCron = settings.checkinCron;
  settingsForm.checkinTime = settings.checkinTime;
  settingsForm.timezone = settings.timezone;
  settingsModalVisible.value = true;
}

function toUnixStart(value: number | null): number | undefined {
  return value ? Math.floor(new Date(value).setHours(0, 0, 0, 0) / 1000) : undefined;
}

function toUnixEnd(value: number | null): number | undefined {
  return value ? Math.floor(new Date(value).setHours(23, 59, 59, 999) / 1000) : undefined;
}

async function refreshLogs(): Promise<void> {
  await loadLogs({
    accountId: logFilters.accountId || undefined,
    status: logFilters.status || undefined,
    startAt: toUnixStart(logFilters.startDate),
    endAt: toUnixEnd(logFilters.endDate),
    limit: logPageSize,
    offset: (logPage.value - 1) * logPageSize
  });
}

function setAccountPage(page: number): void {
  accountPage.value = page;
}

async function setLogPage(page: number): Promise<void> {
  logPage.value = page;
  await refreshLogs();
}

async function resetLogFilters(): Promise<void> {
  logFilters.accountId = null;
  logFilters.status = null;
  logFilters.startDate = null;
  logFilters.endDate = null;
  logPage.value = 1;
  await refreshLogs();
}

async function submitSettings(): Promise<void> {
  if (!settingsForm.checkinTime) {
    message.warning('请选择每日签到时间');
    return;
  }
  const ok = await saveSettings({ ...settingsForm });
  if (ok) settingsModalVisible.value = false;
}

onMounted(() => {
  void loadInitialData();
});
</script>

<style scoped>
:global(.console-main-flat:has(.public-checkin-page) .console-topbar-flat) {
  min-height: 82px;
  padding: 0 24px;
}

:global(.console-main-flat:has(.public-checkin-page) .console-content-flat) {
  padding: 32px;
  background: #f3f4f6;
}

.page-container {
  min-height: 100%;
  padding: 0;
  background-color: transparent;
}

.public-checkin-page {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px;
}

.stat-card {
  position: relative;
  min-height: 102px;
  overflow: hidden;
  border: 1px solid #f1f5f9;
  border-radius: 12px;
  background: #ffffff;
  padding: 20px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}

.stat-title {
  color: #64748b;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
}

.stat-value {
  margin-top: 8px;
  color: #0f172a;
  font-family: var(--font-number);
  font-size: var(--text-stat);
  font-weight: var(--weight-heavy);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
  line-height: 1.1;
}

.stat-blue .stat-value {
  color: #4f46e5;
}

.stat-green .stat-value {
  color: #10b981;
}

.stat-orange .stat-value {
  color: #f97316;
}

.stat-muted::after {
  content: '';
  position: absolute;
  right: 18px;
  bottom: 12px;
  width: 80px;
  height: 50px;
  border-radius: 999px;
  background:
    radial-gradient(circle at 23px 27px, rgba(241, 245, 249, 0.8) 0 12px, transparent 13px),
    radial-gradient(circle at 51px 15px, rgba(241, 245, 249, 0.75) 0 13px, transparent 14px),
    radial-gradient(circle at 70px 29px, rgba(241, 245, 249, 0.65) 0 12px, transparent 13px);
}

.checkin-panel {
  overflow: hidden;
  border: 1px solid #f1f5f9;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}

.panel-toolbar {
  display: flex;
  min-height: 66px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid #f1f5f9;
  background: rgba(249, 250, 251, 0.8);
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
}

.toolbar-left {
  gap: 12px;
}

.toolbar-right {
  gap: 8px;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: #d1d5db;
}

.checkin-panel :deep(.n-button) {
  height: 36px;
  border-radius: 6px;
  font-weight: 600;
}

.checkin-panel :deep(.btn-add) {
  min-width: 109px;
  --n-color: #4f46e5 !important;
  --n-color-hover: #4338ca !important;
  --n-color-pressed: #3730a3 !important;
  --n-color-focus: #4338ca !important;
  --n-border: 1px solid #4f46e5 !important;
  --n-border-hover: 1px solid #4338ca !important;
  --n-border-pressed: 1px solid #3730a3 !important;
  --n-border-focus: 1px solid #4338ca !important;
}

.checkin-panel :deep(.btn-add .n-button__content::before) {
  content: '+';
  margin-right: 8px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.checkin-panel :deep(.btn-checkin) {
  min-width: 80px;
  --n-color: #10b981 !important;
  --n-color-hover: #059669 !important;
  --n-color-pressed: #047857 !important;
  --n-color-focus: #059669 !important;
  --n-border: 1px solid #10b981 !important;
  --n-border-hover: 1px solid #059669 !important;
  --n-border-pressed: 1px solid #047857 !important;
  --n-border-focus: 1px solid #059669 !important;
}

.checkin-panel :deep(.btn-soft),
.checkin-panel :deep(.btn-outline) {
  --n-color: #ffffff !important;
  --n-color-hover: #f8fafc !important;
  --n-color-pressed: #f1f5f9 !important;
  --n-text-color: #0f172a !important;
  --n-text-color-hover: #0f172a !important;
  --n-border: 1px solid #cbd5e1 !important;
  --n-border-hover: 1px solid #94a3b8 !important;
  --n-border-pressed: 1px solid #94a3b8 !important;
}

.accounts-table-wrap {
  overflow-x: auto;
}

.accounts-table {
  width: 100%;
  min-width: 1060px;
  table-layout: fixed;
  border-collapse: collapse;
  text-align: left;
}

.accounts-table thead tr {
  border-bottom: 1px solid #e5e7eb;
  background: rgba(249, 250, 251, 0.5);
}

.accounts-table th {
  padding: 12px 24px;
  color: #64748b;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 20px;
  letter-spacing: 0;
  text-transform: uppercase;
  white-space: nowrap;
}

.accounts-table .col-site {
  width: 180px;
}

.accounts-table .col-balance {
  width: 140px;
}

.accounts-table .col-switch {
  width: 140px;
}

.accounts-table .col-actions {
  width: 300px;
}

.accounts-table th:last-child {
  text-align: right;
}

.accounts-table tbody tr {
  border-bottom: 1px solid #f3f4f6;
  transition: background-color 0.2s ease;
}

.accounts-table tbody tr:hover {
  background: rgba(249, 250, 251, 0.5);
}

.accounts-table td {
  padding: 16px 24px;
  color: #0f172a;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  vertical-align: middle;
}

.accounts-table td:last-child {
  text-align: right;
}

.table-empty {
  display: flex;
  min-height: 82px;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: var(--text-sm);
}

.account-site-link {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  color: #0f172a;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.2s ease;
}

.account-site-link:hover,
.account-site-link:focus-visible {
  color: #4f46e5;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.account-site-link:focus-visible {
  border-radius: 4px;
  outline: 2px solid rgba(79, 70, 229, 0.28);
  outline-offset: 2px;
}

.account-balance-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 100%;
  min-width: 0;
}

.account-balance-cell strong {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: #374151;
  font-family: var(--font-number);
  font-size: var(--text-lg);
  font-weight: var(--weight-heavy);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-balance-cell span {
  color: #9ca3af;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  line-height: 16px;
}

.account-balance-cell span.is-positive {
  color: #16a34a;
}

.account-status-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.muted-small {
  color: #475569;
  font-size: var(--text-xs);
  line-height: 16px;
}

.error-small {
  max-width: 260px;
  overflow: hidden;
  color: #dc2626;
  font-size: var(--text-xs);
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-actions {
  display: inline-flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}

.account-actions :deep(.row-btn) {
  height: 32px;
  min-width: 48px;
  padding: 0 10px !important;
  border: 0 !important;
  border-radius: 6px;
  box-shadow: none !important;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  transition: background-color 0.2s ease, color 0.2s ease;
}

.account-actions :deep(.row-btn-blue) {
  background: #eef2ff !important;
  color: #4f46e5 !important;
}

.account-actions :deep(.row-btn-blue:hover) {
  background: #e0e7ff !important;
  color: #3730a3 !important;
}

.account-actions :deep(.row-btn-green) {
  background: #10b981 !important;
  color: #ffffff !important;
}

.account-actions :deep(.row-btn-green:hover) {
  background: #059669 !important;
}

.account-actions :deep(.row-btn-gray) {
  background: #f3f4f6 !important;
  color: #4b5563 !important;
}

.account-actions :deep(.row-btn-gray:hover) {
  background: #e5e7eb !important;
  color: #111827 !important;
}

.account-actions :deep(.row-btn-red) {
  background: #fef2f2 !important;
  color: #ef4444 !important;
}

.account-actions :deep(.row-btn-red:hover) {
  background: #fee2e2 !important;
  color: #b91c1c !important;
}

.accounts-pagination {
  display: flex;
  min-height: 65px;
  align-items: center;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid #f1f5f9;
}

.accounts-pagination :deep(.n-pagination-item),
.log-pagination :deep(.n-pagination-item) {
  min-width: 34px;
  height: 34px;
  border-radius: 7px;
}

.accounts-pagination :deep(.n-pagination-item--active),
.log-pagination :deep(.n-pagination-item--active) {
  background: #4f46e5 !important;
  color: #ffffff !important;
  border-color: #4f46e5 !important;
}

.account-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.designed-form :deep(.n-form-item) {
  --n-label-height: 22px;
  --n-feedback-height: 18px;
}

.designed-form :deep(.n-form-item-label) {
  padding-bottom: 6px;
  color: #374151;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.designed-form :deep(.n-form-item-blank) {
  min-height: 36px;
}

.designed-form :deep(.n-input),
.designed-form :deep(.n-base-selection) {
  --n-height: 36px !important;
  --n-border-radius: 6px !important;
  --n-border: 1px solid #d1d5db !important;
  --n-border-hover: 1px solid #9ca3af !important;
  --n-border-focus: 1px solid #4f46e5 !important;
  --n-box-shadow-focus: 0 0 0 2px rgba(79, 70, 229, 0.12) !important;
}

.designed-form :deep(textarea.n-input__textarea-el) {
  line-height: 20px;
}

.designed-form :deep(.n-form-item-feedback-wrapper) {
  min-height: 18px;
  padding-top: 4px;
}

.designed-form :deep(.n-form-item-feedback) {
  color: #6b7280;
  font-size: var(--text-xs);
  line-height: 16px;
}

.switch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding-top: 2px;
  color: #374151;
  font-size: var(--text-base);
}

.modal-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
}

.modal-footer-actions {
  display: flex;
  gap: 12px;
}

.log-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.log-filters {
  display: grid;
  grid-template-columns: minmax(170px, 1.2fr) minmax(140px, 0.8fr) minmax(160px, 1fr) minmax(160px, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 16px;
  border: 1px solid #f1f5f9;
  border-radius: 10px;
  background: rgba(249, 250, 251, 0.8);
}

.log-filters :deep(.n-base-selection),
.log-filters :deep(.n-input),
.log-filters :deep(.n-button) {
  --n-height: 36px !important;
  --n-border-radius: 6px !important;
}

.log-table :deep(.n-data-table-th) {
  padding: 12px 16px !important;
  background: rgba(249, 250, 251, 0.5);
  color: #64748b;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.log-table :deep(.n-data-table-td) {
  padding: 14px 16px !important;
  color: #0f172a;
  font-size: var(--text-sm);
}

.log-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding-top: 2px;
  color: #64748b;
  font-size: var(--text-sm);
}

:global(.public-checkin-modal.n-card) {
  overflow: hidden;
  border: 1px solid #f1f5f9;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
}

:global(.public-checkin-modal .n-card-header) {
  min-height: 58px;
  padding: 18px 24px 14px;
  border-bottom: 1px solid #f1f5f9;
}

:global(.public-checkin-modal .n-card-header__main) {
  color: #111827;
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}

:global(.public-checkin-modal .n-card__content) {
  padding: 20px 24px;
}

:global(.public-checkin-modal .n-card__footer) {
  padding: 16px 24px;
  border-top: 1px solid #f1f5f9;
  background: rgba(249, 250, 251, 0.8);
}

:global(.public-checkin-modal .n-card__footer .n-button) {
  height: 36px;
  border-radius: 6px;
  font-weight: var(--weight-semibold);
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

@media (max-width: 980px) {
  :global(.console-main-flat:has(.public-checkin-page) .console-content-flat) {
    padding: 24px;
  }

  .stats-grid {
    grid-template-columns: 1fr 1fr;
  }

  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-left,
  .toolbar-right {
    flex-wrap: wrap;
  }

  .form-grid,
  .log-filters {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  :global(.console-main-flat:has(.public-checkin-page) .console-topbar-flat),
  :global(.console-main-flat:has(.public-checkin-page) .console-content-flat) {
    padding-left: 16px;
    padding-right: 16px;
  }

  .stats-grid,
  .form-grid,
  .log-filters {
    grid-template-columns: 1fr;
  }

  .modal-footer {
    flex-direction: column;
  }

  .modal-footer-actions {
    justify-content: flex-end;
  }
}
</style>
