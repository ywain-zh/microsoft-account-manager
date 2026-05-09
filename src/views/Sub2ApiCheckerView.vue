<template>
  <div class="page-container sub2api-page">
    <n-card
      class="main-card"
      :bordered="false"
      content-style="padding: 24px; display: flex; flex-direction: column; gap: 20px;"
    >
      <div class="toolbar">
        <span class="tag-pill blue">鉴权: x-api-key</span>
        <span class="tag-pill green">模型: {{ modelId }}</span>
        <button class="btn btn-default" type="button" @click="showConfigModal = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          配置信息
        </button>

        <button
          class="btn btn-success"
          type="button"
          :disabled="runLoading || !hasConfiguredSub2Api"
          @click="startDetection"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          {{ runLoading ? '检测中...' : '开始检测' }}
        </button>

        <button
          class="btn btn-danger-ghost"
          type="button"
          :disabled="runLoading || deleteLoading || !hasUnauthorizedCandidates"
          @click="clearUnauthorizedAccounts"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          {{ deleteLoading ? '清理中...' : `一键清除 401 账号 (${unauthorizedCandidates.length})` }}
        </button>

        <button class="btn btn-default" type="button" :disabled="logs.length === 0" @click="clearLogs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="1 4 1 10 7 10"></polyline>
            <polyline points="23 20 23 14 17 14"></polyline>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
          </svg>
          清空日志
        </button>
      </div>

      <div class="stats-grid">
        <div v-for="item in summaryCards" :key="item.key" class="stat-card" :class="[`c-${item.tone}`, item.clickable ? 'is-clickable' : '']">
          <div class="stat-title">{{ item.label }}</div>
          <button
            v-if="item.clickable"
            class="stat-value stat-value-button"
            type="button"
            :disabled="!item.enabled"
            @click="item.onClick?.()"
          >
            {{ item.value }}
          </button>
          <div v-else class="stat-value">{{ item.value }}</div>
        </div>
      </div>

      <div class="log-section">
        <div class="log-section-header">
          <div>
            <span class="log-title">检测日志</span>
            <span class="log-desc">
              已处理 {{ progress.processedAccounts }} / {{ summary.totalAccounts }}
              <template v-if="progress.currentAccountName">
                ，当前账号 {{ progress.currentAccountName }}
              </template>
              <template v-if="runLoading && progress.outcome === 'timeout'">
                ，上一账号检测超时，已继续后续检测
              </template>
            </span>
          </div>
          <span class="run-status" :class="runLoading ? 'is-running' : 'is-idle'">
            {{ runLoading ? '检测中' : '待运行' }}
          </span>
        </div>

        <div ref="logTerminalRef" class="log-terminal">
          <div v-if="logs.length === 0" class="log-empty">检测开始后，日志会实时输出在这里。</div>
          <div v-for="item in logs" :key="item.id" class="log-line">
            <span class="log-time">{{ formatLogTime(item.timestamp) }}</span>
            <span class="log-badge" :class="resolveLevelBadgeTone(item.level)">
              {{ resolveLevelLabel(item.level) }}
            </span>
            <span class="log-message">{{ item.message }}</span>
          </div>
        </div>
      </div>
    </n-card>

    <n-modal v-model:show="showConfigModal" preset="card" title="连接配置" style="width: 600px; border-radius: 12px;">
      <p class="config-modal-desc">所有检测请求都由本项目后端发起，页面不会直接暴露 Sub2API 管理员 Key。</p>
      <n-form label-placement="top" autocomplete="off" class="config-modal-form">
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="username" />
          <input type="password" tabindex="-1" autocomplete="current-password" />
        </div>

        <n-form-item label="Sub2API 地址">
          <n-input
            v-model:value="configForm.baseUrl"
            placeholder="例如：http://47.251.82.144:8080"
            :input-props="baseUrlInputProps"
            @keyup.enter="handleSaveConfig"
          />
        </n-form-item>

        <n-form-item label="管理员 API Key">
          <n-input
            v-model:value="configForm.adminApiKey"
            type="password"
            show-password-on="click"
            placeholder="请输入 x-api-key"
            :input-props="apiKeyInputProps"
            @keyup.enter="handleSaveConfig"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="config-modal-footer">
          <n-button @click="showConfigModal = false">取消</n-button>
          <n-button type="primary" :loading="configSaving" @click="handleSaveConfig">保存配置</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showAbnormalAccountsModal"
      preset="card"
      title="异常账号列表"
      style="width: min(920px, 94vw); border-radius: 12px;"
    >
      <div class="abnormal-modal-body">
        <div class="abnormal-modal-summary">
          共 {{ abnormalCandidatesTotal }} 个异常账号，默认每页 {{ abnormalAccountsPageSize }} 条。
        </div>

        <div v-if="pagedAbnormalCandidates.length === 0" class="abnormal-empty">
          当前没有异常账号。
        </div>

        <div v-else class="abnormal-table-wrap">
          <table class="abnormal-table">
            <thead>
              <tr>
                <th>账号</th>
                <th>报错信息</th>
                <th class="actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedAbnormalCandidates" :key="item.accountId">
                <td class="account-cell">{{ resolveIssueLabel(item) }}</td>
                <td class="reason-cell">{{ item.reason }}</td>
                <td class="actions">
                  <n-button
                    type="error"
                    text
                    :loading="isDeletingAbnormalAccount(item.accountId)"
                    :disabled="deleteLoading"
                    @click="deleteAbnormalAccount(item)"
                  >
                    删除
                  </n-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <template #footer>
        <div class="abnormal-modal-footer">
          <n-pagination
            v-if="abnormalCandidatesTotal > abnormalAccountsPageSize"
            :page="abnormalAccountsPage"
            :page-count="abnormalAccountsTotalPages"
            @update:page="setAbnormalAccountsPage"
          />
          <n-button @click="closeAbnormalAccountsModal">关闭</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton, NCard, NForm, NFormItem, NInput, NModal, NPagination } from 'naive-ui';
import { useSub2ApiConsole } from '../state/sub2api-console';
import type { Sub2ApiDetectedIssueItem, Sub2ApiLogLevel } from '../types';

const sub2api = useSub2ApiConsole();
const {
  initialDataLoaded,
  configSaving,
  runLoading,
  deleteLoading,
  configForm,
  summary,
  progress,
  logs,
  unauthorizedCandidates,
  pagedAbnormalCandidates,
  abnormalCandidatesTotal,
  abnormalAccountsTotalPages,
  abnormalAccountsPage,
  abnormalAccountsPageSize,
  modelId,
  hasConfiguredSub2Api,
  hasUnauthorizedCandidates,
  hasAbnormalCandidates,
  showAbnormalAccountsModal,
  loadInitialData,
  saveConfig,
  clearLogs,
  openAbnormalAccountsModal,
  closeAbnormalAccountsModal,
  setAbnormalAccountsPage,
  startDetection,
  clearUnauthorizedAccounts,
  deleteAbnormalAccount,
  isDeletingAbnormalAccount,
  stopDetection
} = sub2api;

const showConfigModal = ref(false);
const logTerminalRef = ref<HTMLElement | null>(null);

const baseUrlInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'sub2api-base-url',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

const apiKeyInputProps = {
  autocomplete: 'new-password',
  name: 'sub2api-admin-api-key',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

const summaryCards = computed(() => {
  return [
    {
      key: 'totalAccounts',
      label: '总账号数',
      value: summary.totalAccounts,
      tone: 'gray'
    },
    {
      key: 'availableAccounts',
      label: '总可用账号',
      value: summary.availableAccounts,
      tone: 'green'
    },
    {
      key: 'freeAvailableAccounts',
      label: 'Free 可用',
      value: summary.freeAvailableAccounts,
      tone: 'blue'
    },
    {
      key: 'plusAvailableAccounts',
      label: 'Plus 可用',
      value: summary.plusAvailableAccounts,
      tone: 'purple'
    },
    {
      key: 'teamAvailableAccounts',
      label: 'Team 可用',
      value: summary.teamAvailableAccounts,
      tone: 'blue'
    },
    {
      key: 'quotaExhaustedAccounts',
      label: '额度清空数',
      value: summary.quotaExhaustedAccounts,
      tone: 'yellow'
    },
    {
      key: 'unauthorizedAccounts',
      label: '401 账号数',
      value: summary.unauthorizedAccounts,
      tone: 'red'
    },
    {
      key: 'abnormalAccounts',
      label: '异常账号数',
      value: summary.abnormalAccounts,
      tone: 'red',
      clickable: true,
      enabled: hasAbnormalCandidates.value,
      onClick: openAbnormalAccountsModal
    }
  ];
});

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }

  return date.toLocaleTimeString();
}

function resolveLevelLabel(level: Sub2ApiLogLevel): string {
  if (level === 'success') {
    return 'OK';
  }

  if (level === 'warning' || level === 'error') {
    return 'WARN';
  }

  return 'INFO';
}

function resolveLevelBadgeTone(level: Sub2ApiLogLevel): 'ok' | 'warn' | 'info' {
  if (level === 'success') {
    return 'ok';
  }

  if (level === 'warning' || level === 'error') {
    return 'warn';
  }

  return 'info';
}

function resolveIssueLabel(item: Pick<Sub2ApiDetectedIssueItem, 'accountId' | 'accountName'>): string {
  return item.accountName?.trim() || `账号 ID ${item.accountId}`;
}

async function handleSaveConfig(): Promise<void> {
  await saveConfig();
}

async function scrollTerminalToBottom(): Promise<void> {
  await nextTick();
  const element = logTerminalRef.value;
  if (!element) {
    return;
  }
  element.scrollTop = element.scrollHeight;
}

watch(
  () => logs.value.length,
  () => {
    void scrollTerminalToBottom();
  }
);

onMounted(async () => {
  if (!initialDataLoaded.value) {
    await loadInitialData();
  }
});

onBeforeUnmount(() => {
  stopDetection();
});
</script>

<style scoped>
.page-container {
  padding: 24px;
  background-color: #f4f6f8;
  min-height: 100%;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  display: flex;
  align-items: baseline;
  margin-bottom: 8px;
  gap: 12px;
  flex-wrap: wrap;
}

.page-title h1 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
  color: #1e293b;
}

.tag-pill {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
}

.tag-pill.blue {
  background-color: #ecf5ff;
  color: #409eff;
  border-color: #d9ebff;
}

.tag-pill.green {
  background-color: #f0fdf4;
  color: #16a34a;
  border-color: #dcfce7;
}

.page-desc {
  color: #94a3b8;
  font-size: 14px;
  margin: 0;
}

.main-card {
  border-radius: 12px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.03);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 20px;
  border-bottom: 1px solid #f1f5f9;
  flex-wrap: wrap;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
  background: #fff;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn svg {
  width: 16px;
  height: 16px;
}

.btn:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}

.btn-default {
  border-color: #e2e8f0;
  color: #1e293b;
}

.btn-default:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
}

.btn-success {
  background: #10b981;
  color: #fff;
}

.btn-success:hover:not(:disabled) {
  background: #059669;
}

.btn-danger-ghost {
  background: transparent;
  color: #f56c6c;
  border-color: #f56c6c;
}

.btn-danger-ghost:hover:not(:disabled) {
  background: #fef0f0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 12px;
}

.stat-card {
  background-color: #ffffff;
  border: 1px solid #f1f5f9;
  border-radius: 6px;
  padding: 12px 14px;
  position: relative;
  overflow: hidden;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
}

.stat-card.c-gray::before {
  background-color: #cbd5e1;
}

.stat-card.c-green::before {
  background-color: #10b981;
}

.stat-card.c-blue::before {
  background-color: #3b82f6;
}

.stat-card.c-purple::before {
  background-color: #8b5cf6;
}

.stat-card.c-yellow::before {
  background-color: #f59e0b;
}

.stat-card.c-red::before {
  background-color: #ef4444;
}

.stat-card.is-clickable {
  border-color: #dbeafe;
}

.stat-title {
  font-size: 12px;
  color: #475569;
  margin-bottom: 4px;
  font-weight: 500;
  white-space: nowrap;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}

.stat-value-button {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  color: #2563eb;
  transition: color 0.2s ease;
}

.stat-value-button:hover:not(:disabled) {
  color: #1d4ed8;
}

.stat-value-button:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}

.log-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.log-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}

.log-desc {
  font-size: 13px;
  color: #94a3b8;
  margin-left: 12px;
}

.run-status {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.run-status.is-running {
  background: #fef3c7;
  color: #b45309;
}

.run-status.is-idle {
  background: #e2e8f0;
  color: #475569;
}

.log-terminal {
  background-color: #0f172a;
  border-radius: 8px;
  padding: 16px;
  height: 440px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #e2e8f0;
}

.log-empty {
  color: #94a3b8;
}

.log-line {
  margin-bottom: 6px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.log-time {
  color: #64748b;
  flex-shrink: 0;
}

.log-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  flex-shrink: 0;
  width: 44px;
  text-align: center;
}

.log-badge.warn {
  background-color: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.log-badge.info {
  background-color: rgba(56, 130, 246, 0.2);
  color: #60a5fa;
}

.log-badge.ok {
  background-color: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.log-message {
  color: #cbd5e1;
  word-break: break-all;
}

.config-modal-desc {
  font-size: 13px;
  color: #94a3b8;
  margin: 0 0 24px;
}

.config-modal-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.form-autofill-guard {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.abnormal-modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.abnormal-modal-summary {
  font-size: 13px;
  color: #64748b;
}

.abnormal-empty {
  border: 1px dashed #dbe3f0;
  border-radius: 10px;
  padding: 32px 16px;
  text-align: center;
  color: #94a3b8;
  background: #f8fafc;
}

.abnormal-table-wrap {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.abnormal-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  background: #fff;
}

.abnormal-table th,
.abnormal-table td {
  padding: 14px 16px;
  border-bottom: 1px solid #eef2f7;
  text-align: left;
  vertical-align: top;
}

.abnormal-table th {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
}

.abnormal-table tbody tr:last-child td {
  border-bottom: none;
}

.abnormal-table .account-cell {
  width: 220px;
  color: #0f172a;
  word-break: break-all;
}

.abnormal-table .reason-cell {
  color: #334155;
  white-space: pre-wrap;
  word-break: break-word;
}

.abnormal-table .actions {
  width: 96px;
  text-align: right;
}

.abnormal-modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

@media (max-width: 1440px) {
  .stats-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .log-section-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .abnormal-modal-footer {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 640px) {
  .page-container {
    padding: 16px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .log-line {
    flex-direction: column;
    gap: 6px;
  }

  .log-desc {
    display: block;
    margin-left: 0;
    margin-top: 6px;
  }

  .abnormal-table,
  .abnormal-table thead,
  .abnormal-table tbody,
  .abnormal-table tr,
  .abnormal-table th,
  .abnormal-table td {
    display: block;
  }

  .abnormal-table thead {
    display: none;
  }

  .abnormal-table td {
    width: 100%;
    text-align: left;
    padding: 12px 14px;
  }

  .abnormal-table .actions {
    width: 100%;
    text-align: left;
  }
}
</style>
