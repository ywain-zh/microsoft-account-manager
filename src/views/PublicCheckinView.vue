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
            <col class="col-announcement">
            <col class="col-actions">
          </colgroup>
          <thead>
            <tr>
              <th>公益站</th>
              <th>余额</th>
              <th>自动签到</th>
              <th>状态</th>
              <th>公告</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="6">
                <div class="table-empty">加载中...</div>
              </td>
            </tr>
            <tr v-else-if="!accounts.length">
              <td colspan="6">
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
                    <span
                      v-if="hasDailyBalanceDisplay(account)"
                      class="account-balance-cell__daily"
                      :class="dailyBalanceDisplayClass(account)"
                      :title="dailyBalanceDisplayTitle(account)"
                    >
                      {{ formatDailyBalanceDisplay(account) }}
                    </span>
                  </div>
                </td>
                <td>
                  <span
                    class="auto-checkin-badge"
                    :class="account.checkinEnabled ? 'is-on' : 'is-off'"
                    title="如需修改自动签到，请进入编辑账号"
                  >
                    {{ account.checkinEnabled ? '开启' : '关闭' }}
                  </span>
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
                  <div class="announcement-cell">
                    <n-button
                      class="announcement-pill"
                      :class="{ 'has-unread': account.announcementUnreadCount > 0 }"
                      size="small"
                      :disabled="isAccountBusy(account.id)"
                      :aria-label="`查看 ${account.site.name} 的公告`"
                      @click="openAnnouncementsModal(account)"
                    >
                      <span class="announcement-pill__label">公告</span>
                      <span v-if="account.announcementUnreadCount > 0" class="announcement-pill__badge">
                        {{ formatAnnouncementUnreadCount(account.announcementUnreadCount) }}
                      </span>
                      <span v-else class="announcement-pill__hint">查看</span>
                    </n-button>
                  </div>
                </td>
                <td>
                  <div class="account-actions">
                    <n-button
                      class="row-btn row-btn-blue"
                      :class="{ 'is-loading-pretty': isAccountActionLoading(account.id, 'test') }"
                      size="small"
                      :loading="isAccountActionLoading(account.id, 'test')"
                      :disabled="isAccountBusy(account.id)"
                      @click="testAccount(account.id)"
                    >
                      <span class="row-btn-label">检测</span>
                    </n-button>
                    <n-button
                      class="row-btn row-btn-violet"
                      :class="{ 'is-loading-pretty': isAccountActionLoading(account.id, 'models') }"
                      size="small"
                      :loading="isAccountActionLoading(account.id, 'models')"
                      :disabled="isAccountBusy(account.id)"
                      @click="openModelsModal(account)"
                    >
                      <span class="row-btn-label">模型</span>
                    </n-button>
                    <n-button
                      class="row-btn row-btn-green"
                      :class="{ 'is-loading-pretty': isAccountActionLoading(account.id, 'checkin') }"
                      size="small"
                      :loading="isAccountActionLoading(account.id, 'checkin')"
                      :disabled="isAccountBusy(account.id)"
                      @click="runAccountCheckin(account.id)"
                    >
                      <span class="row-btn-label">签到</span>
                    </n-button>
                    <n-button
                      class="row-btn row-btn-gray"
                      :class="{ 'is-loading-pretty': isAccountActionLoading(account.id, 'balance') }"
                      size="small"
                      :loading="isAccountActionLoading(account.id, 'balance')"
                      :disabled="isAccountBusy(account.id)"
                      @click="refreshAccountBalance(account.id)"
                    >
                      <span class="row-btn-label">余额</span>
                    </n-button>
                    <n-button class="row-btn row-btn-gray" size="small" :disabled="isAccountBusy(account.id)" @click="openEditModal(account)">编辑</n-button>
                    <n-button class="row-btn row-btn-red" size="small" :disabled="isAccountBusy(account.id)" @click="confirmDelete(account)">删除</n-button>
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
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="username" name="public-checkin-autofill-username" />
          <input type="password" tabindex="-1" autocomplete="new-password" name="public-checkin-autofill-password" />
        </div>

        <div class="form-grid">
          <n-form-item label="站点名称">
            <n-input
              v-model:value="accountForm.siteName"
              placeholder="例如：公益站 A"
              :input-props="accountSiteNameInputProps"
            />
          </n-form-item>
          <n-form-item label="站点 URL">
            <n-input
              v-model:value="accountForm.siteUrl"
              placeholder="https://new-api.example.com"
              :input-props="accountSiteUrlInputProps"
            />
          </n-form-item>
        </div>

        <n-form-item :label="editingAccount ? 'Key（留空则不修改）' : 'Key'">
          <n-input
            v-model:value="accountForm.key"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 8 }"
            :input-props="accountKeyInputProps"
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
            :input-props="accountPlatformUserIdInputProps"
          />
        </n-form-item>

        <n-form-item :label="editingAccount ? '模型检测 API Key（留空则不修改）' : '模型检测 API Key'">
          <SecretInput
            v-model:value="accountForm.apiKey"
            placeholder="仅用于模型检测，填写站点的 API Key"
            :input-props="accountApiKeyInputProps"
          />
          <template #feedback>
            该 Key 仅用于“模型”按钮的模型列表和测速，不影响签到、余额和连接检测。
          </template>
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

    <n-modal v-model:show="logModalVisible" preset="card" class="public-checkin-modal log-modal" title="签到日志" style="width: min(920px, 94vw); border-radius: 12px;">
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
          :single-line="true"
          :pagination="false"
          size="small"
          class="log-table"
        />
        <div class="log-pagination">
          <span>共 {{ logs.total }} 条</span>
          <n-pagination :page="logPage" :page-count="logPageCount" @update:page="setLogPage" />
        </div>
      </div>
    </n-modal>

    <n-modal
      v-model:show="announcementsModalVisible"
      preset="card"
      class="public-checkin-modal announcements-modal"
      :title="announcementsModalTitle"
      style="width: min(860px, 96vw); border-radius: 16px;"
    >
      <div class="announcements-panel">
        <div class="announcements-toolbar">
          <div class="announcements-toolbar-copy">
            <span class="announcements-site">{{ announcementModalAccount?.site.name || '公益站公告' }}</span>
            <span class="announcements-meta">{{ announcementsMetaText }}</span>
          </div>
          <n-button
            class="announcement-sync-btn"
            :loading="announcementsSyncing"
            :disabled="!announcementModalAccount"
            @click="syncAnnouncementsManually"
          >
            同步公告
          </n-button>
        </div>

        <div v-if="announcementsLoading && !announcements.length" class="announcements-skeleton-list" aria-live="polite">
          <div v-for="index in 3" :key="index" class="announcement-skeleton-card"></div>
        </div>

        <div v-else-if="announcementError && !announcements.length" class="announcement-state announcement-state-error" role="alert">
          <div class="announcement-state__title">这次没有拿到公告</div>
          <div class="announcement-state__text">{{ announcementError }}</div>
          <n-button class="announcement-sync-btn" :loading="announcementsSyncing" @click="syncAnnouncementsManually">
            重新同步
          </n-button>
        </div>

        <div v-else-if="!announcements.length" class="announcement-state">
          <div class="announcement-state__title">还没有发现公告</div>
          <div class="announcement-state__text">
            通知和系统公告会统一归并在这里。打开弹框后会先读本地记录，再自动同步一次站点公告。
          </div>
        </div>

        <template v-else>
          <div v-if="announcementError" class="announcement-inline-error" role="alert">
            {{ announcementError }}
          </div>

          <div class="announcements-list">
            <article
              v-for="item in announcements"
              :key="item.id"
              class="announcement-card"
              :class="[`is-${item.level}`, { 'is-collapsed': !isAnnouncementExpanded(item.id) }]"
            >
              <div class="announcement-card__header">
                <div class="announcement-card__title-wrap">
                  <h3 class="announcement-card__title">{{ item.title || '站点公告' }}</h3>
                  <n-tag :type="announcementLevelTagType(item.level)" size="small" :bordered="false">
                    {{ announcementLevelLabel(item.level) }}
                  </n-tag>
                </div>
                <div class="announcement-card__meta">
                  <span>首次发现 {{ formatAnnouncementTime(item.firstSeenAt || item.lastSeenAt) }}</span>
                  <span class="announcement-read-state" :class="{ 'is-unread': !item.readAt }">
                    {{ item.readAt ? '已读' : '未读' }}
                  </span>
                  <button
                    class="announcement-card__toggle"
                    type="button"
                    :aria-expanded="isAnnouncementExpanded(item.id)"
                    @click="toggleAnnouncementExpanded(item.id)"
                  >
                    {{ isAnnouncementExpanded(item.id) ? '收起' : '展开' }}
                  </button>
                </div>
              </div>

              <div
                v-if="isAnnouncementExpanded(item.id)"
                class="announcement-card__content"
                v-html="renderAnnouncementHtml(item.content)"
              ></div>

              <div class="announcement-card__footer">
                <span class="announcement-card__seen">最近同步 {{ formatAnnouncementTime(item.lastSeenAt || item.firstSeenAt) }}</span>
                <a
                  v-if="item.sourceUrl"
                  class="announcement-card__source"
                  :href="item.sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看来源
                </a>
                <span v-else class="announcement-card__source is-muted">无来源链接</span>
              </div>
            </article>
          </div>
        </template>
      </div>

      <template #footer>
        <div class="modal-footer">
          <div class="announcements-footer-note">
            {{ announcementsSyncing ? '正在抓取站点公告，完成后会自动清掉未读数。' : '公告只在首次发现时推送 Telegram；后续刷新只更新本地记录。' }}
          </div>
          <div class="modal-footer-actions">
            <n-button @click="announcementsModalVisible = false">关闭</n-button>
          </div>
        </div>
      </template>
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
        <n-form-item label="公告自动检测">
          <n-select v-model:value="settingsForm.announcementPollingIntervalMinutes" :options="announcementPollingOptions" />
          <template #feedback>默认 30 分钟一次，任务串行执行且不可重叠，避免对公益站造成明显压力。</template>
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

    <n-modal v-model:show="modelsModalVisible" preset="card" class="public-checkin-modal models-modal" :title="modelsModalTitle" style="width: min(680px, 94vw); border-radius: 12px;">
      <div class="models-modal-body">
        <div class="models-summary">
          <span>共 {{ modelProbeItems.length }} 个模型</span>
          <span v-if="modelsLoading" class="models-summary-loading">正在读取...</span>
        </div>

        <div v-if="modelsLoading && modelProbeItems.length === 0" class="models-loading-list">
          <div v-for="index in 6" :key="index" class="model-skeleton-row"></div>
        </div>

        <div v-else-if="modelProbeItems.length === 0" class="table-empty">
          未读取到可用模型。该站点暂时没有返回模型列表，请确认 API Key 有模型权限，或稍后再试。
        </div>

        <div v-else class="models-list">
          <div
            v-for="item in modelProbeItems"
            :key="item.model"
            class="model-entry"
          >
            <div class="model-row" :class="modelRowClass(item.model)">
              <div class="model-row-main">
                <span class="model-row-indicator"></span>
                <span class="model-row-name">{{ item.model }}</span>
              </div>
              <div class="model-row-actions">
                <span
                  v-if="modelProbeResults[item.model]"
                  class="model-probe-status"
                  :class="modelProbeResults[item.model]?.success ? 'is-success' : 'is-failed'"
                >
                  {{ modelProbeResults[item.model]?.success ? '成功' : '失败' }}
                </span>
                <n-button
                  size="small"
                  secondary
                  type="primary"
                  :loading="isModelProbeLoading(item.model)"
                  :disabled="isAnotherModelProbeRunning(item.model)"
                  @click="runModelProbe(item.model)"
                >
                  {{ modelProbeResults[item.model] ? '重试' : '检测' }}
                </n-button>
              </div>
            </div>

            <div v-if="activeModelProbeName === item.model && activeModelProbePanel" class="model-probe-panel">
              <div class="model-probe-log">
                <div class="model-probe-line">
                  <span class="model-probe-label">开始检测站点：</span>
                  <span class="model-probe-value">{{ activeModelProbePanel.siteName }}</span>
                </div>
                <div class="model-probe-line">
                  <span class="model-probe-label">已选模型：</span>
                  <span class="model-probe-value">{{ activeModelProbePanel.model }}</span>
                </div>
                <div class="model-probe-line">
                  <span class="model-probe-label">发送测试消息：</span>
                  <span class="model-probe-value">"{{ activeModelProbePanel.prompt }}"</span>
                </div>
                <div v-if="activeModelProbeLoading" class="model-probe-line is-muted">
                  正在等待模型响应...
                </div>
                <template v-else>
                  <div class="model-probe-line">
                    <span class="model-probe-label">{{ activeModelProbePanel.success ? '响应：' : '失败：' }}</span>
                  </div>
                  <pre class="model-probe-response">{{ activeModelProbePanel.success ? activeModelProbePanel.responseText : activeModelProbePanel.errorMessage }}</pre>
                  <div class="model-probe-divider"></div>
                  <div class="model-probe-footer" :class="activeModelProbePanel.success ? 'is-success' : 'is-failed'">
                    <span>{{ activeModelProbePanel.success ? '检测完成' : '检测失败' }}</span>
                    <span>{{ activeModelProbePanel.latencyMs }} ms</span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <div class="modal-footer-actions">
            <n-button @click="closeModelsModal">关闭</n-button>
          </div>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue';
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
  NTag,
  NTimePicker,
  createDiscreteApi,
  type DataTableColumns
} from 'naive-ui';
import SecretInput from '../components/SecretInput.vue';
import { api } from '../api';
import { usePublicCheckinConsole } from '../state/public-checkin-console';
import { renderPublicCheckinAnnouncementContent } from '../utils/public-checkin-announcements';
import type {
  PublicCheckinAccount,
  PublicCheckinAnnouncement,
  PublicCheckinLog,
  PublicCheckinModelProbeItem,
  PublicCheckinSingleModelProbeResponse,
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
} = publicCheckin;

const accountModalVisible = ref(false);
const logModalVisible = ref(false);
const announcementsModalVisible = ref(false);
const settingsModalVisible = ref(false);
const modelsModalVisible = ref(false);
const connectionTesting = ref(false);
const editingAccount = ref<PublicCheckinAccount | null>(null);
const announcementModalAccount = ref<PublicCheckinAccount | null>(null);
const announcements = ref<PublicCheckinAnnouncement[]>([]);
const announcementsLoading = ref(false);
const announcementsSyncing = ref(false);
const announcementError = ref('');
const modelsLoading = ref(false);
const modelsModalSiteName = ref('');
const modelProbeItems = ref<PublicCheckinModelProbeItem[]>([]);
const modelsModalAccountId = ref<number | null>(null);
const activeModelProbeName = ref('');
const activeModelProbeLoading = ref(false);
const activeModelProbePanel = ref<PublicCheckinSingleModelProbeResponse | null>(null);
const modelProbeResults = ref<Record<string, PublicCheckinSingleModelProbeResponse>>({});
const expandedAnnouncementIds = ref<Set<number>>(new Set());
const accountPage = ref(1);
const accountPageSize = 12;
const logPage = ref(1);
const logPageSize = 10;
const announcementCache = new Map<number, PublicCheckinAnnouncement[]>();
let announcementSessionId = 0;
let announcementSyncedSessionId: number | null = null;

const accountSiteNameInputProps = {
  autocomplete: 'off',
  name: 'public-checkin-site-name',
  spellcheck: false
};

const accountSiteUrlInputProps = {
  autocomplete: 'off',
  name: 'public-checkin-site-url',
  spellcheck: false
};

const accountKeyInputProps = {
  autocomplete: 'new-password',
  name: 'public-checkin-credential-key',
  spellcheck: false
};

const accountPlatformUserIdInputProps = {
  autocomplete: 'off',
  inputmode: 'numeric',
  name: 'public-checkin-platform-user-id',
  spellcheck: false
};

const accountApiKeyInputProps = {
  autocomplete: 'new-password',
  name: 'public-checkin-model-api-key',
  spellcheck: false
};

const accountForm = reactive({
  siteName: '',
  siteUrl: '',
  key: '',
  apiKey: '',
  platformUserId: '',
  checkinEnabled: true,
  useProxy: true
});

const settingsForm = reactive<PublicCheckinSettings>({
  checkinCron: '0 8 * * *',
  checkinTime: '08:00',
  timezone: 'Asia/Shanghai',
  announcementPollingIntervalMinutes: 30
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
const announcementPollingOptions: Array<{ label: string; value: 15 | 30 | 60 }> = [
  { label: '15 分钟一次', value: 15 },
  { label: '30 分钟一次', value: 30 },
  { label: '60 分钟一次', value: 60 }
];

const accountPageCount = computed(() => Math.max(1, Math.ceil(accounts.value.length / accountPageSize)));
const pagedAccounts = computed(() => {
  if (accountPage.value > accountPageCount.value) accountPage.value = accountPageCount.value;
  const start = (accountPage.value - 1) * accountPageSize;
  return accounts.value.slice(start, start + accountPageSize);
});
const logPageCount = computed(() => Math.max(1, Math.ceil(logs.total / logPageSize)));
type PublicCheckinBusyAction = NonNullable<typeof busyAccountAction.value>;
const modelsModalTitle = computed(() => modelsModalSiteName.value ? `模型管理 · ${modelsModalSiteName.value}` : '模型管理');
const announcementsModalTitle = computed(() => {
  const siteName = announcementModalAccount.value?.site.name;
  return siteName ? `公益站公告 · ${siteName}` : '公益站公告';
});
const announcementsMetaText = computed(() => {
  const account = announcementModalAccount.value;
  if (!account) return '通知和系统公告会统一归并在一个公告流里。';
  if (announcementsSyncing.value) return '正在同步站点公告...';
  if (announcements.value.length === 0) return '暂时还没有抓到通知或系统公告。';
  const unreadCount = announcements.value.filter((item) => !item.readAt).length;
  return `共 ${announcements.value.length} 条，${unreadCount > 0 ? `${unreadCount} 条未读` : '已全部读完'}`;
});

const logColumns: DataTableColumns<PublicCheckinLog> = [
  {
    title: '账号',
    key: 'account',
    minWidth: 150,
    render(row) {
      const label = row.accountLabel || row.siteName || '-';
      const siteName = row.siteName || '';
      const text = siteName && siteName !== label ? `${label} · ${siteName}` : label;
      return h('span', { class: 'log-account-name', title: text }, text);
    }
  },
  {
    title: '触发',
    key: 'triggeredBy',
    width: 76,
    render(row) {
      return row.triggeredBy === 'manual' ? '手动' : '定时';
    }
  },
  {
    title: '状态',
    key: 'status',
    width: 76,
    render(row) {
      return h(NTag, { type: statusTagType(row.status), size: 'small', bordered: false }, { default: () => statusLabel(row.status) });
    }
  },
  {
    title: '奖励',
    key: 'reward',
    width: 86,
    render(row) {
      return formatMoney(row.reward);
    }
  },
  {
    title: '说明',
    key: 'message',
    minWidth: 220,
    render(row) {
      return row.rewardNote || row.errorMessage || '-';
    }
  },
  {
    title: '执行时间',
    key: 'executedAt',
    width: 160,
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

function hasDailyBalanceDisplay(account: PublicCheckinAccount): boolean {
  const amount = account.dailyBalanceDisplayAmount;
  return account.dailyBalanceDisplayMode !== 'none'
    && typeof amount === 'number'
    && Number.isFinite(amount)
    && amount > 0;
}

function formatDailyBalanceDisplay(account: PublicCheckinAccount): string {
  if (!hasDailyBalanceDisplay(account)) return '';
  const amount = Math.abs(account.dailyBalanceDisplayAmount || 0);
  const sign = account.dailyBalanceDisplayMode === 'usage' ? '-' : '+';
  return `${sign}${formatMoney(amount)}`;
}

function dailyBalanceDisplayTitle(account: PublicCheckinAccount): string {
  if (account.dailyBalanceDisplayMode === 'usage') return '今日已用';
  if (account.dailyBalanceDisplayMode === 'reward') return '今日签到奖励';
  return '';
}

function dailyBalanceDisplayClass(account: PublicCheckinAccount): string {
  if (account.dailyBalanceDisplayMode === 'usage') return 'is-usage';
  if (account.dailyBalanceDisplayMode === 'reward') return 'is-reward';
  return '';
}

function formatAnnouncementTime(value: number | null | undefined): string {
  return formatTime(value);
}

function formatAnnouncementUnreadCount(count: number): string {
  if (count > 99) return '99+';
  return String(Math.max(0, count));
}

function announcementLevelLabel(level: PublicCheckinAnnouncement['level']): string {
  if (level === 'warning') return '系统公告';
  if (level === 'error') return '重要公告';
  return '通知';
}

function announcementLevelTagType(level: PublicCheckinAnnouncement['level']): 'info' | 'warning' | 'error' {
  if (level === 'warning') return 'warning';
  if (level === 'error') return 'error';
  return 'info';
}

function renderAnnouncementHtml(content: string): string {
  return renderPublicCheckinAnnouncementContent(content);
}

function resetExpandedAnnouncements(items: PublicCheckinAnnouncement[]): void {
  const nextExpanded = new Set<number>();
  if (items.length > 0) {
    nextExpanded.add(items[0].id);
  }
  expandedAnnouncementIds.value = nextExpanded;
}

function isAnnouncementExpanded(id: number): boolean {
  return expandedAnnouncementIds.value.has(id);
}

function toggleAnnouncementExpanded(id: number): void {
  const next = new Set(expandedAnnouncementIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedAnnouncementIds.value = next;
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function cloneAnnouncements(items: PublicCheckinAnnouncement[]): PublicCheckinAnnouncement[] {
  return items.map((item) => ({ ...item }));
}

function cacheAnnouncements(siteId: number, items: PublicCheckinAnnouncement[]): void {
  announcementCache.set(siteId, cloneAnnouncements(items));
}

function readCachedAnnouncements(siteId: number): PublicCheckinAnnouncement[] {
  return cloneAnnouncements(announcementCache.get(siteId) || []);
}

function isCurrentAnnouncementSession(sessionId: number): boolean {
  return sessionId === announcementSessionId;
}

function isAccountBusy(accountId: number): boolean {
  return busyAccountId.value === accountId;
}

function isAccountActionLoading(accountId: number, action: PublicCheckinBusyAction): boolean {
  return busyAccountId.value === accountId && busyAccountAction.value === action;
}

function resetModelsModalState(): void {
  modelsLoading.value = false;
  modelsModalAccountId.value = null;
  modelsModalSiteName.value = '';
  modelProbeItems.value = [];
  activeModelProbeName.value = '';
  activeModelProbeLoading.value = false;
  activeModelProbePanel.value = null;
  modelProbeResults.value = {};
}

function isModelProbeLoading(model: string): boolean {
  return activeModelProbeLoading.value && activeModelProbeName.value === model;
}

function isAnotherModelProbeRunning(model: string): boolean {
  return activeModelProbeLoading.value && activeModelProbeName.value !== model;
}

function modelRowClass(model: string): string {
  const result = modelProbeResults.value[model];
  if (!result) return 'is-idle';
  return result.success ? 'is-success' : 'is-failed';
}

function resetAccountForm(): void {
  accountForm.siteName = '';
  accountForm.siteUrl = '';
  accountForm.key = '';
  accountForm.apiKey = '';
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
  accountForm.apiKey = '';
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
    accountForm.apiKey = credential.apiKey || '';
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

async function openModelsModal(account: PublicCheckinAccount): Promise<void> {
  if (!account.hasApiKey) {
    message.warning(`请先在“${account.site.name}”账号的编辑弹窗里配置 API Key`);
    return;
  }

  resetModelsModalState();
  const requestedAccountId = account.id;
  modelsModalAccountId.value = account.id;
  modelsModalSiteName.value = account.site.name;
  modelsModalVisible.value = true;
  modelsLoading.value = true;

  try {
    const result = await testAccountModels(account.id);
    if (modelsModalAccountId.value !== requestedAccountId || !modelsModalVisible.value) {
      return;
    }
    modelsModalSiteName.value = result.siteName;
    modelProbeItems.value = result.items;
  } catch (error) {
    if (modelsModalAccountId.value === requestedAccountId) {
      modelsModalVisible.value = false;
    }
    handleApiError(error);
  } finally {
    if (modelsModalAccountId.value === requestedAccountId || !modelsModalVisible.value) {
      modelsLoading.value = false;
    }
  }
}

async function runModelProbe(model: string): Promise<void> {
  if (!modelsModalAccountId.value || activeModelProbeLoading.value) {
    return;
  }

  const currentAccountId = modelsModalAccountId.value;
  activeModelProbeName.value = model;
  activeModelProbeLoading.value = true;
  activeModelProbePanel.value = {
    accountId: currentAccountId,
    siteName: modelsModalSiteName.value,
    model,
    success: false,
    prompt: 'Hi',
    responseText: null,
    errorMessage: '',
    latencyMs: 0,
    checkedAt: 0
  };

  try {
    const result = await api.probePublicCheckinModel(currentAccountId, { model });
    if (modelsModalAccountId.value !== currentAccountId || activeModelProbeName.value !== model || !modelsModalVisible.value) {
      return;
    }
    modelProbeResults.value = {
      ...modelProbeResults.value,
      [model]: result
    };
    activeModelProbePanel.value = result;
  } catch (error) {
    if (modelsModalAccountId.value !== currentAccountId || activeModelProbeName.value !== model || !modelsModalVisible.value) {
      return;
    }
    const failureResult: PublicCheckinSingleModelProbeResponse = {
      accountId: currentAccountId,
      siteName: modelsModalSiteName.value,
      model,
      success: false,
      prompt: 'Hi',
      responseText: null,
      errorMessage: toErrorMessage(error, '检测失败'),
      latencyMs: 0,
      checkedAt: Math.floor(Date.now() / 1000)
    };
    modelProbeResults.value = {
      ...modelProbeResults.value,
      [model]: failureResult
    };
    activeModelProbePanel.value = failureResult;
  } finally {
    if (activeModelProbeName.value === model) {
      activeModelProbeLoading.value = false;
    }
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

function closeModelsModal(): void {
  modelsModalVisible.value = false;
  resetModelsModalState();
}

watch(modelsModalVisible, (visible) => {
  if (!visible) {
    resetModelsModalState();
  }
});

async function loadAnnouncementsFromStore(account: PublicCheckinAccount, sessionId: number, showLoading: boolean): Promise<void> {
  if (showLoading) {
    announcementsLoading.value = true;
  }

  try {
    const items = await api.listPublicCheckinAnnouncements(account.id);
    if (!isCurrentAnnouncementSession(sessionId) || announcementSyncedSessionId === sessionId) {
      return;
    }
    cacheAnnouncements(account.siteId, items);
    announcements.value = cloneAnnouncements(items);
    resetExpandedAnnouncements(items);
    announcementSyncedSessionId = sessionId;
    announcementError.value = '';
  } catch (error) {
    if (!isCurrentAnnouncementSession(sessionId)) {
      return;
    }
    if (announcements.value.length === 0) {
      announcementError.value = toErrorMessage(error, '读取本地公告失败');
    }
  } finally {
    if (showLoading && isCurrentAnnouncementSession(sessionId)) {
      announcementsLoading.value = false;
    }
  }
}

async function markAnnouncementFeedRead(account: PublicCheckinAccount, sessionId: number): Promise<void> {
  try {
    await api.markPublicCheckinAnnouncementsRead(account.id);
    if (!isCurrentAnnouncementSession(sessionId)) {
      return;
    }
    const readAt = Math.floor(Date.now() / 1000);
    const next = announcements.value.map((item) => ({
      ...item,
      readAt: item.readAt || readAt
    }));
    announcements.value = next;
    cacheAnnouncements(account.siteId, next);
  } catch (error) {
    if (isCurrentAnnouncementSession(sessionId)) {
      announcementError.value = toErrorMessage(error, '公告已同步，但标记已读失败');
    }
  } finally {
    try {
      await reloadSummary();
    } catch (error) {
      handleApiError(error);
    }
  }
}

async function syncAnnouncementsForAccount(
  account: PublicCheckinAccount,
  options: {
    sessionId?: number;
    showMessage?: boolean;
  } = {}
): Promise<void> {
  const sessionId = options.sessionId ?? announcementSessionId;
  announcementsSyncing.value = true;

  try {
    const items = await api.syncPublicCheckinAnnouncements(account.id);
    if (!isCurrentAnnouncementSession(sessionId)) {
      return;
    }
    cacheAnnouncements(account.siteId, items);
    announcements.value = cloneAnnouncements(items);
    resetExpandedAnnouncements(items);
    announcementError.value = '';
    await markAnnouncementFeedRead(account, sessionId);
    if (options.showMessage && isCurrentAnnouncementSession(sessionId)) {
      message.success('公告已同步');
    }
  } catch (error) {
    if (!isCurrentAnnouncementSession(sessionId)) {
      return;
    }
    const nextMessage = toErrorMessage(error, '同步公告失败');
    announcementError.value = nextMessage;
    if (options.showMessage) {
      message.error(nextMessage);
    }
  } finally {
    if (isCurrentAnnouncementSession(sessionId)) {
      announcementsSyncing.value = false;
    }
  }
}

function openAnnouncementsModal(account: PublicCheckinAccount): void {
  announcementModalAccount.value = account;
  announcementsModalVisible.value = true;
  announcementError.value = '';

  const cached = readCachedAnnouncements(account.siteId);
  announcements.value = cached;
  resetExpandedAnnouncements(cached);
  announcementsLoading.value = cached.length === 0;

  const sessionId = ++announcementSessionId;
  announcementSyncedSessionId = null;
  void loadAnnouncementsFromStore(account, sessionId, cached.length === 0);
  void syncAnnouncementsForAccount(account, { sessionId });
}

async function syncAnnouncementsManually(): Promise<void> {
  if (!announcementModalAccount.value) {
    return;
  }
  await syncAnnouncementsForAccount(announcementModalAccount.value, { showMessage: true });
}

function openSettingsModal(): void {
  settingsForm.checkinCron = settings.checkinCron;
  settingsForm.checkinTime = settings.checkinTime;
  settingsForm.timezone = settings.timezone;
  settingsForm.announcementPollingIntervalMinutes = settings.announcementPollingIntervalMinutes;
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
  min-width: 1120px;
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
  width: 168px;
}

.accounts-table .col-balance {
  width: 132px;
}

.accounts-table .col-switch {
  width: 126px;
}

.accounts-table .col-status {
  width: 168px;
}

.accounts-table .col-announcement {
  width: 84px;
}

.accounts-table .col-actions {
  width: 384px;
}

.accounts-table th:last-child {
  text-align: left;
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

.accounts-table th:nth-child(5),
.accounts-table td:nth-child(5) {
  padding-left: 4px;
  padding-right: 8px;
}

.accounts-table th:nth-child(4),
.accounts-table td:nth-child(4) {
  padding-right: 8px;
}

.accounts-table td:last-child {
  text-align: left;
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

.account-balance-cell__daily {
  color: #9ca3af;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  line-height: 16px;
}

.account-balance-cell__daily.is-reward {
  color: #16a34a;
}

.account-balance-cell__daily.is-usage {
  color: #dc2626;
}

.auto-checkin-badge {
  display: inline-flex;
  min-width: 52px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1;
}

.auto-checkin-badge.is-on {
  background: #dcfce7;
  color: #15803d;
}

.auto-checkin-badge.is-off {
  background: #f1f5f9;
  color: #64748b;
}

.account-status-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.announcement-cell {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  transform: translateX(-20px);
}

.announcement-cell :deep(.announcement-pill) {
  min-width: 84px;
  height: 36px;
  padding: 0 10px !important;
  border-radius: 999px;
  --n-color: rgba(238, 242, 255, 0.96) !important;
  --n-color-hover: #e0e7ff !important;
  --n-color-pressed: #c7d2fe !important;
  --n-color-focus: #e0e7ff !important;
  --n-text-color: #3730a3 !important;
  --n-text-color-hover: #312e81 !important;
  --n-border: 1px solid rgba(99, 102, 241, 0.2) !important;
  --n-border-hover: 1px solid rgba(99, 102, 241, 0.28) !important;
  --n-border-pressed: 1px solid rgba(99, 102, 241, 0.32) !important;
  --n-border-focus: 1px solid rgba(99, 102, 241, 0.32) !important;
  box-shadow: 0 8px 18px rgba(79, 70, 229, 0.08);
  backdrop-filter: blur(12px);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.announcement-cell :deep(.announcement-pill .n-button__content) {
  gap: 6px;
}

.announcement-cell :deep(.announcement-pill:not(.n-button--disabled):hover) {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(79, 70, 229, 0.12);
}

.announcement-cell :deep(.announcement-pill.has-unread) {
  --n-color: rgba(255, 247, 237, 0.96) !important;
  --n-color-hover: #ffedd5 !important;
  --n-color-pressed: #fed7aa !important;
  --n-color-focus: #ffedd5 !important;
  --n-text-color: #9a3412 !important;
  --n-text-color-hover: #7c2d12 !important;
  --n-border: 1px solid rgba(249, 115, 22, 0.22) !important;
  --n-border-hover: 1px solid rgba(249, 115, 22, 0.32) !important;
  --n-border-pressed: 1px solid rgba(249, 115, 22, 0.38) !important;
  --n-border-focus: 1px solid rgba(249, 115, 22, 0.38) !important;
  box-shadow: 0 12px 24px rgba(249, 115, 22, 0.12);
}

.announcement-pill__label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  letter-spacing: 0.01em;
}

.announcement-pill__hint {
  color: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  opacity: 0.78;
}

.announcement-pill__badge {
  display: inline-flex;
  min-width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: 999px;
  background: linear-gradient(135deg, #fb923c, #f97316);
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  box-shadow: 0 8px 16px rgba(249, 115, 22, 0.24);
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
  justify-content: flex-start;
  gap: 6px;
  white-space: nowrap;
}

.account-actions :deep(.row-btn) {
  position: relative;
  height: 32px;
  min-width: 48px;
  padding: 0 8px !important;
  border: 0 !important;
  border-radius: 6px;
  box-shadow: none !important;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  transition: background-color 0.22s ease, color 0.22s ease, transform 0.18s ease, box-shadow 0.22s ease;
}

.account-actions :deep(.row-btn:not(.n-button--disabled):hover) {
  transform: translateY(-1px);
}

.account-actions :deep(.row-btn:not(.n-button--disabled):focus-visible) {
  outline: 2px solid rgba(79, 70, 229, 0.18);
  outline-offset: 2px;
}

.account-actions :deep(.row-btn .n-button__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.account-actions :deep(.row-btn .row-btn-label) {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.account-actions :deep(.row-btn.is-loading-pretty .row-btn-label) {
  opacity: 0;
  transform: translateY(3px);
}

.account-actions :deep(.row-btn.is-loading-pretty .n-button__icon) {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 !important;
}

.account-actions :deep(.row-btn.is-loading-pretty .n-base-loading) {
  width: 26px;
  height: 10px;
}

.account-actions :deep(.row-btn.is-loading-pretty .n-base-loading__container) {
  display: flex;
  width: 26px;
  align-items: center;
  justify-content: space-between;
}

.account-actions :deep(.row-btn.is-loading-pretty .n-base-loading__container > span) {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.28;
  transform: scale(0.72);
  animation: row-btn-pulse 0.95s ease-in-out infinite;
}

.account-actions :deep(.row-btn.is-loading-pretty .n-base-loading__container > span:nth-child(2)) {
  animation-delay: 0.12s;
}

.account-actions :deep(.row-btn.is-loading-pretty .n-base-loading__container > span:nth-child(3)) {
  animation-delay: 0.24s;
}

.account-actions :deep(.row-btn.n-button--disabled) {
  opacity: 0.7;
}

.account-actions :deep(.row-btn-blue) {
  background: #eef2ff !important;
  color: #4f46e5 !important;
}

.account-actions :deep(.row-btn-blue:hover) {
  background: #e0e7ff !important;
  color: #3730a3 !important;
  box-shadow: 0 8px 18px rgba(79, 70, 229, 0.12);
}

.account-actions :deep(.row-btn-green) {
  background: #10b981 !important;
  color: #ffffff !important;
}

.account-actions :deep(.row-btn-green:hover) {
  background: #059669 !important;
  box-shadow: 0 8px 18px rgba(16, 185, 129, 0.16);
}

.account-actions :deep(.row-btn-violet) {
  background: #f3e8ff !important;
  color: #7c3aed !important;
}

.account-actions :deep(.row-btn-violet:hover) {
  background: #ede9fe !important;
  color: #6d28d9 !important;
  box-shadow: 0 8px 18px rgba(124, 58, 237, 0.14);
}

.account-actions :deep(.row-btn-gray) {
  background: #f3f4f6 !important;
  color: #4b5563 !important;
}

.account-actions :deep(.row-btn-gray:hover) {
  background: #e5e7eb !important;
  color: #111827 !important;
  box-shadow: 0 8px 18px rgba(148, 163, 184, 0.12);
}

.account-actions :deep(.row-btn-red) {
  background: #fef2f2 !important;
  color: #ef4444 !important;
}

.account-actions :deep(.row-btn-red:hover) {
  background: #fee2e2 !important;
  color: #b91c1c !important;
  box-shadow: 0 8px 18px rgba(239, 68, 68, 0.12);
}

@keyframes row-btn-pulse {
  0%,
  80%,
  100% {
    opacity: 0.28;
    transform: scale(0.72);
  }

  40% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .account-actions :deep(.row-btn),
  .account-actions :deep(.row-btn .row-btn-label),
  .account-actions :deep(.row-btn.is-loading-pretty .n-base-loading__container > span) {
    transition: none;
    animation: none;
  }

  .account-actions :deep(.row-btn.is-loading-pretty .row-btn-label) {
    opacity: 0;
    transform: none;
  }

  .account-actions :deep(.row-btn:not(.n-button--disabled):hover) {
    transform: none;
  }
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

.models-modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.announcements-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.announcements-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 16px;
  background:
    linear-gradient(140deg, rgba(255, 255, 255, 0.96), rgba(238, 242, 255, 0.84)),
    radial-gradient(circle at top right, rgba(251, 146, 60, 0.1), transparent 45%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 14px 28px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(16px);
}

.announcements-toolbar-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.announcements-site {
  color: #0f172a;
  font-size: 15px;
  font-weight: var(--weight-bold);
}

.announcements-meta {
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.announcements-toolbar :deep(.announcement-sync-btn) {
  min-width: 104px;
  height: 38px;
  border-radius: 999px;
  --n-color: #ffffff !important;
  --n-color-hover: #eef2ff !important;
  --n-color-pressed: #e0e7ff !important;
  --n-color-focus: #eef2ff !important;
  --n-text-color: #3730a3 !important;
  --n-text-color-hover: #312e81 !important;
  --n-border: 1px solid rgba(99, 102, 241, 0.22) !important;
  --n-border-hover: 1px solid rgba(99, 102, 241, 0.32) !important;
  --n-border-pressed: 1px solid rgba(99, 102, 241, 0.38) !important;
  --n-border-focus: 1px solid rgba(99, 102, 241, 0.38) !important;
}

.announcements-skeleton-list,
.announcements-list {
  display: flex;
  max-height: min(62vh, 620px);
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding-right: 4px;
}

.announcement-skeleton-card {
  height: 126px;
  border-radius: 18px;
  background:
    linear-gradient(90deg, rgba(226, 232, 240, 0.72) 22%, rgba(248, 250, 252, 0.98) 50%, rgba(226, 232, 240, 0.72) 78%);
  background-size: 200% 100%;
  animation: models-skeleton-shimmer 1.2s linear infinite;
}

.announcement-state {
  display: flex;
  min-height: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px dashed #cbd5e1;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.9));
  padding: 28px 24px;
  text-align: center;
}

.announcement-state-error {
  border-color: #fdba74;
  background: linear-gradient(180deg, rgba(255, 247, 237, 0.92), rgba(255, 255, 255, 0.94));
}

.announcement-state__title {
  color: #0f172a;
  font-size: 16px;
  font-weight: var(--weight-bold);
}

.announcement-state__text {
  max-width: 460px;
  color: #64748b;
  font-size: var(--text-sm);
  line-height: 1.68;
}

.announcement-inline-error {
  border: 1px solid #fed7aa;
  border-radius: 14px;
  background: #fff7ed;
  padding: 12px 14px;
  color: #9a3412;
  font-size: 13px;
  line-height: 1.6;
}

.announcement-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.94)),
    radial-gradient(circle at top right, rgba(79, 70, 229, 0.08), transparent 42%);
  padding: 18px;
  box-shadow: 0 16px 30px rgba(15, 23, 42, 0.06);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.announcement-card::before {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 0;
  width: 4px;
  border-radius: 999px;
  background: #6366f1;
}

.announcement-card.is-warning::before {
  background: #f59e0b;
}

.announcement-card.is-error::before {
  background: #ef4444;
}

.announcement-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 20px 32px rgba(15, 23, 42, 0.08);
}

.announcement-card__header,
.announcement-card__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.announcement-card__title-wrap {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.announcement-card__toggle {
  border: 0;
  background: transparent;
  padding: 0;
  color: #4f46e5;
  font-size: 12px;
  font-weight: var(--weight-semibold);
  line-height: 1.4;
  cursor: pointer;
}

.announcement-card__toggle:hover,
.announcement-card__toggle:focus-visible {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.announcement-card__title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: var(--weight-bold);
  line-height: 1.4;
}

.announcement-card__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.announcement-read-state {
  color: #475569;
  font-weight: var(--weight-semibold);
}

.announcement-read-state.is-unread {
  color: #ea580c;
}

.announcement-card__content {
  color: #334155;
  font-size: 14px;
  line-height: 1.55;
}

.announcement-card.is-collapsed .announcement-card__content {
  display: none;
}

.announcement-card__content :deep(p) {
  margin: 0 0 0.5em;
}

.announcement-card__content :deep(p:last-child) {
  margin-bottom: 0;
}

.announcement-card__content :deep(a) {
  color: #4f46e5;
  text-decoration: none;
}

.announcement-card__content :deep(a:hover),
.announcement-card__content :deep(a:focus-visible) {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.announcement-card__content :deep(ul),
.announcement-card__content :deep(ol) {
  margin: 0.35em 0 0.55em 1.25em;
  padding: 0;
}

.announcement-card__content :deep(li + li) {
  margin-top: 0.24em;
}

.announcement-card__content :deep(center) {
  margin: 0.35em 0;
}

.announcement-card__content :deep(br) {
  line-height: 1.15;
}

.announcement-card__content :deep(strong),
.announcement-card__content :deep(b) {
  color: #0f172a;
}

.announcement-card__content :deep(code) {
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 6px;
  background: rgba(241, 245, 249, 0.9);
  padding: 0.08em 0.38em;
  color: #1e293b;
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.announcement-card__content :deep(pre) {
  overflow: auto;
  max-width: 100%;
  margin: 0.5em 0;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 10px;
  background: #f8fafc;
  padding: 10px 12px;
}

.announcement-card__content :deep(pre code) {
  display: block;
  border: 0;
  background: transparent;
  padding: 0;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre;
}

.announcement-card__seen,
.announcement-card__source {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.announcement-card__source {
  color: #4f46e5;
  font-weight: var(--weight-semibold);
  text-decoration: none;
}

.announcement-card__source:hover,
.announcement-card__source:focus-visible {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.announcement-card__source.is-muted {
  color: #94a3b8;
}

.announcements-footer-note {
  max-width: 520px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.58;
}

.models-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #64748b;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.models-summary-loading {
  color: #7c3aed;
}

.models-loading-list,
.models-list {
  display: flex;
  max-height: min(56vh, 520px);
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.model-skeleton-row {
  height: 50px;
  border-radius: 10px;
  background:
    linear-gradient(90deg, rgba(226, 232, 240, 0.7) 25%, rgba(241, 245, 249, 0.96) 50%, rgba(226, 232, 240, 0.7) 75%);
  background-size: 200% 100%;
  animation: models-skeleton-shimmer 1.2s linear infinite;
}

.model-entry {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  padding: 14px 16px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.18s ease;
}

.model-row:hover {
  transform: translateY(-1px);
}

.model-row.is-success {
  border-color: #dcfce7;
  box-shadow: 0 10px 18px rgba(16, 185, 129, 0.08);
}

.model-row.is-failed {
  border-color: #fecaca;
  box-shadow: 0 10px 18px rgba(239, 68, 68, 0.08);
}

.model-row-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.model-row-indicator {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: currentColor;
  flex-shrink: 0;
}

.model-row.is-success .model-row-indicator {
  color: #10b981;
}

.model-row.is-failed .model-row-indicator {
  color: #ef4444;
}

.model-row.is-idle .model-row-indicator {
  color: #94a3b8;
}

.model-row-name {
  overflow: hidden;
  color: #0f172a;
  font-family: var(--font-number);
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.model-probe-status {
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}

.model-probe-status.is-success {
  background: #dcfce7;
  color: #166534;
}

.model-probe-status.is-failed {
  background: #fee2e2;
  color: #b91c1c;
}

.model-probe-panel {
  border-radius: 14px;
  background: #101828;
  padding: 16px;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.12);
}

.model-probe-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #dbeafe;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
}

.model-probe-line {
  color: #cbd5e1;
}

.model-probe-line.is-muted {
  color: #94a3b8;
}

.model-probe-label {
  color: #93c5fd;
}

.model-probe-value {
  color: #f8fafc;
}

.model-probe-response {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #86efac;
}

.model-probe-divider {
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  margin-top: 4px;
  padding-top: 4px;
}

.model-probe-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 700;
}

.model-probe-footer.is-success {
  color: #4ade80;
}

.model-probe-footer.is-failed {
  color: #fca5a5;
}

@keyframes models-skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
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
  gap: 12px;
}

.log-filters {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(120px, 0.8fr) minmax(140px, 1fr) minmax(140px, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  background: rgba(249, 250, 251, 0.8);
}

.log-filters :deep(.n-base-selection),
.log-filters :deep(.n-input),
.log-filters :deep(.n-button) {
  --n-height: 34px !important;
  --n-border-radius: 6px !important;
}

.log-table :deep(.n-data-table-th) {
  padding: 10px 14px !important;
  background: rgba(249, 250, 251, 0.5);
  color: #64748b;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.log-table :deep(.n-data-table-td) {
  padding: 11px 14px !important;
  color: #0f172a;
  font-size: var(--text-sm);
}

.log-account-name {
  display: block;
  max-width: 180px;
  overflow: hidden;
  color: #0f172a;
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
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

:global(.announcements-modal.n-card) {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.94)),
    radial-gradient(circle at top right, rgba(99, 102, 241, 0.08), transparent 38%);
  backdrop-filter: blur(20px);
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
  .toolbar-right,
  .announcements-toolbar,
  .announcement-card__header,
  .announcement-card__footer {
    flex-wrap: wrap;
  }

  .announcements-toolbar {
    align-items: flex-start;
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

  .announcement-card {
    padding: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .announcement-cell :deep(.announcement-pill),
  .announcement-card,
  .announcement-skeleton-card {
    transition: none;
    animation: none;
  }

  .announcement-cell :deep(.announcement-pill:not(.n-button--disabled):hover),
  .announcement-card:hover {
    transform: none;
  }
}
</style>
