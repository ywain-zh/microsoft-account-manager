<template>
  <div class="page-container sub2api-page">
    <n-card
      class="main-card"
      :bordered="false"
      content-style="padding: 24px; display: flex; flex-direction: column; gap: 20px;"
    >
      <div class="toolbar">
        <div class="toolbar-filters">
          <div class="control-field group-control">
            <span class="control-label">分组</span>
            <n-select
              v-model:value="selectedSub2ApiGroupName"
              class="group-picker-select"
              :options="groupOptions"
              :loading="groupLoading"
              filterable
              clearable
              size="small"
              :disabled="runLoading || !hasConfiguredSub2Api"
              placeholder="选择分组"
            />
            <n-button
              size="small"
              :loading="groupLoading"
              :disabled="runLoading || configSaving || !hasConfiguredSub2Api"
              @click="syncSub2ApiGroups()"
            >
              同步
            </n-button>
            <span class="control-status" :class="{ 'is-error': groupSyncError }">
              {{ groupSyncStatusText }}
            </span>
          </div>

          <div class="control-field model-control">
            <span class="control-label">模型</span>
            <n-select
              v-model:value="modelId"
              class="model-picker-select"
              filterable
              tag
              size="small"
              :options="modelOptions"
              :disabled="runLoading"
              placeholder="模型"
            />
            <n-button
              size="small"
              :loading="modelLoading"
              :disabled="runLoading || !hasConfiguredSub2Api"
              @click="refreshModels"
            >
              获取
            </n-button>
          </div>
        </div>

        <div class="toolbar-actions">
          <button class="btn btn-default" type="button" @click="openConfigModal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 2v3"></path>
              <path d="M12 19v3"></path>
              <path d="m4.93 4.93 2.12 2.12"></path>
              <path d="m16.95 16.95 2.12 2.12"></path>
              <path d="M2 12h3"></path>
              <path d="M19 12h3"></path>
              <path d="m4.93 19.07 2.12-2.12"></path>
              <path d="m16.95 7.05 2.12-2.12"></path>
            </svg>
            连接配置
          </button>

          <button
            class="btn btn-success"
            type="button"
            :disabled="runLoading || !hasConfiguredSub2Api || !hasSelectedTargetGroup"
            @click="startDetection"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            {{ runLoading ? '检测中...' : '开始检测' }}
          </button>

          <button
            class="btn btn-import"
            type="button"
            :disabled="runLoading || !hasConfiguredSub2Api || !hasSelectedTargetGroup"
            @click="openImportModal"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12"></path>
              <path d="m7 10 5 5 5-5"></path>
              <path d="M5 21h14"></path>
            </svg>
            导入 API
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
            {{ deleteLoading ? '清理中...' : `清理 401 (${unauthorizedCandidates.length})` }}
          </button>

          <button class="btn btn-quiet" type="button" :disabled="logs.length === 0" @click="clearLogs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="1 4 1 10 7 10"></polyline>
              <polyline points="23 20 23 14 17 14"></polyline>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
            </svg>
            清空日志
          </button>
        </div>
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
              已处理 {{ progress.processedAccounts }} / {{ progress.totalAccounts || summary.totalAccounts }}
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

    <n-modal v-model:show="showConfigModal" preset="card" title="连接配置" style="width: min(520px, 94vw); border-radius: 10px;">
      <div class="config-modal-desc">
        检测请求由本项目后端发起，页面不会直接暴露管理员 Key。
      </div>
      <n-form label-placement="top" autocomplete="off" class="config-modal-form">
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="off" />
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
          <SecretInput
            v-model:value="configForm.adminApiKey"
            placeholder="请输入管理员 API Key"
            :input-props="apiKeyInputProps"
            @keyup.enter="handleSaveConfig"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="config-modal-footer">
          <n-button @click="showConfigModal = false">取消</n-button>
          <n-button type="primary" :loading="configSaving" @click="handleSaveConfigAndClose">保存配置</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      v-model:show="importModalVisible"
      preset="card"
      title="导入 API-SUB2API"
      style="width: min(1040px, 94vw); border-radius: 12px;"
    >
      <div class="import-modal-body">
        <div class="import-target-bar">
          <span class="import-target-label">目标分组</span>
          <span class="import-target-name">{{ selectedSub2ApiGroupName || '未选择' }}</span>
          <span class="import-target-count">
            可导入 {{ validImportPreviewItems.length }} 条
            <template v-if="invalidImportPreviewItems.length > 0">，需检查 {{ invalidImportPreviewItems.length }} 条</template>
          </span>
        </div>

        <div class="import-workspace">
          <div class="import-panel">
            <div class="import-panel-title">粘贴内容</div>
            <n-input
              v-model:value="importRawText"
              type="textarea"
              :autosize="{ minRows: 12, maxRows: 18 }"
              placeholder="可粘贴 baseurl/api_key、JSON、.env、curl Header 或混合文本"
            />
          </div>

          <div class="import-panel">
            <div class="import-panel-title">解析预览</div>
            <div v-if="importPreviewItems.length === 0" class="import-empty">
              粘贴后会自动识别 Base URL 和 API Key。
            </div>
            <div v-else class="import-preview-list">
              <div
                v-for="item in importPreviewItems"
                :key="`${item.index}-${item.baseUrl}-${item.maskedApiKey}`"
                class="import-preview-item"
                :class="item.status === 'valid' ? 'is-valid' : 'is-invalid'"
              >
                <div class="import-preview-main">
                  <div class="import-preview-name">{{ item.name || item.baseUrl || `第 ${item.index} 条` }}</div>
                  <div class="import-preview-url">{{ item.baseUrl || '-' }}</div>
                  <div class="import-preview-key">{{ item.maskedApiKey || '-' }}</div>
                </div>
                <div class="import-preview-status">
                  {{ item.message }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="importResult" class="import-result">
          <div class="import-result-summary">
            导入结果：新增 {{ importResult.created }} 个，跳过 {{ importResult.skipped }} 个，失败 {{ importResult.failed }} 个
          </div>
          <div class="import-result-list">
            <div
              v-for="item in importResult.items"
              :key="`${item.status}-${item.baseUrl}-${item.message}`"
              class="import-result-item"
              :class="`is-${item.status}`"
            >
              <span class="import-result-status">{{ resolveImportStatusLabel(item.status) }}</span>
              <span class="import-result-url">{{ item.baseUrl }}</span>
              <span class="import-result-message">{{ item.message }}</span>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="import-modal-footer">
          <n-button @click="closeImportModal">关闭</n-button>
          <n-button
            type="primary"
            :loading="importSubmitting"
            :disabled="validImportPreviewItems.length === 0"
            @click="handleSubmitImport"
          >
            确认导入
          </n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showUnauthorizedAccountsModal"
      preset="card"
      title="401 账号列表"
      style="width: min(920px, 94vw); border-radius: 12px;"
    >
      <div class="abnormal-modal-body">
        <div class="abnormal-modal-summary">
          共 {{ unauthorizedCandidatesTotal }} 个 401 账号，默认每页 {{ abnormalAccountsPageSize }} 条。
        </div>

        <div v-if="pagedUnauthorizedCandidates.length === 0" class="abnormal-empty">
          当前没有 401 账号。
        </div>

        <div v-else class="abnormal-table-wrap">
          <table class="abnormal-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>账号名 / ID</th>
                <th>报错信息</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedUnauthorizedCandidates" :key="item.accountId">
                <td class="account-cell">{{ item.accountEmail || '-' }}</td>
                <td class="account-cell">{{ item.accountName || `账号 ID ${item.accountId}` }}</td>
                <td class="reason-cell">{{ item.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <template #footer>
        <div class="abnormal-modal-footer">
          <n-pagination
            v-if="unauthorizedCandidatesTotal > abnormalAccountsPageSize"
            :page="unauthorizedAccountsPage"
            :page-count="unauthorizedAccountsTotalPages"
            @update:page="setUnauthorizedAccountsPage"
          />
          <n-button @click="closeUnauthorizedAccountsModal">关闭</n-button>
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
import { NButton, NCard, NForm, NFormItem, NInput, NModal, NPagination, NSelect } from 'naive-ui';
import SecretInput from '../components/SecretInput.vue';
import { useSub2ApiConsole } from '../state/sub2api-console';
import type { Sub2ApiDetectedIssueItem, Sub2ApiLogLevel } from '../types';
import { formatTimeBeijing } from '../utils/datetime';

const sub2api = useSub2ApiConsole();
const {
  initialDataLoaded,
  configSaving,
  runLoading,
  deleteLoading,
  modelLoading,
  groupLoading,
  configForm,
  summary,
  progress,
  logs,
  unauthorizedCandidates,
  pagedUnauthorizedCandidates,
  pagedAbnormalCandidates,
  unauthorizedCandidatesTotal,
  abnormalCandidatesTotal,
  unauthorizedAccountsTotalPages,
  abnormalAccountsTotalPages,
  unauthorizedAccountsPage,
  abnormalAccountsPage,
  abnormalAccountsPageSize,
  modelId,
  modelOptions,
  selectedSub2ApiGroupName,
  groupOptions,
  groupSyncStatusText,
  groupSyncError,
  importModalVisible,
  importRawText,
  importSubmitting,
  importPreviewItems,
  validImportPreviewItems,
  invalidImportPreviewItems,
  importResult,
  hasConfiguredSub2Api,
  hasSelectedTargetGroup,
  hasUnauthorizedCandidates,
  hasAbnormalCandidates,
  showUnauthorizedAccountsModal,
  showAbnormalAccountsModal,
  loadInitialData,
  refreshModels,
  syncSub2ApiGroups,
  saveConfig,
  clearLogs,
  openUnauthorizedAccountsModal,
  closeUnauthorizedAccountsModal,
  setUnauthorizedAccountsPage,
  openAbnormalAccountsModal,
  closeAbnormalAccountsModal,
  setAbnormalAccountsPage,
  openImportModal,
  closeImportModal,
  submitImport,
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
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'sub2api-admin-secret',
  inputmode: 'text',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-form-type': 'other'
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
      tone: 'red',
      clickable: true,
      enabled: hasUnauthorizedCandidates.value,
      onClick: openUnauthorizedAccountsModal
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
  return formatTimeBeijing(value);
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

function resolveIssueLabel(item: Pick<Sub2ApiDetectedIssueItem, 'accountId' | 'accountName' | 'accountEmail'>): string {
  return item.accountEmail?.trim() || item.accountName?.trim() || `账号 ID ${item.accountId}`;
}

function resolveImportStatusLabel(status: 'created' | 'skipped' | 'failed'): string {
  if (status === 'created') {
    return '新增';
  }

  if (status === 'skipped') {
    return '跳过';
  }

  return '失败';
}

async function handleSubmitImport(): Promise<void> {
  await submitImport();
}

async function handleSaveConfig(): Promise<void> {
  const configSaved = await saveConfig();
  if (configSaved) {
    void syncSub2ApiGroups({ silent: true });
  }
}

async function handleSaveConfigAndClose(): Promise<void> {
  const configSaved = await saveConfig();
  if (configSaved) {
    void syncSub2ApiGroups({ silent: true });
    showConfigModal.value = false;
  }
}

function openConfigModal(): void {
  showConfigModal.value = true;
  void syncSub2ApiGroups({ silent: true });
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
  margin: 0;
  color: #1e293b;
  font-size: var(--text-page-title);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
}

.page-desc {
  color: #94a3b8;
  font-size: var(--text-sm);
  line-height: 1.45;
  margin: 0;
}

.main-card {
  border-radius: 12px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.03);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  margin-bottom: 2px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  flex-wrap: wrap;
}

.toolbar-filters,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.toolbar-filters {
  flex: 1 1 560px;
  min-width: 0;
}

.toolbar-actions {
  justify-content: flex-end;
  flex: 1 1 460px;
}

.control-field {
  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  min-height: 38px;
  padding: 4px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #eff6ff;
}

.group-control {
  grid-template-columns: auto minmax(164px, 190px) auto minmax(124px, auto);
}

.model-control {
  grid-template-columns: auto 132px auto;
  border-color: #dcfce7;
  background: #f0fdf4;
}

.control-label {
  padding: 0 8px;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  color: #1d4ed8;
  white-space: nowrap;
}

.model-control .control-label {
  color: #15803d;
}

.control-status {
  max-width: 180px;
  padding: 0 8px;
  color: #64748b;
  font-size: var(--text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.control-status.is-error {
  color: #dc2626;
}

.group-picker-select {
  width: 100%;
}

.model-picker-select {
  width: 132px;
}

:deep(.group-picker-select .n-base-selection),
:deep(.model-picker-select .n-base-selection) {
  --n-border: 1px solid transparent !important;
  --n-border-hover: 1px solid #bfdbfe !important;
  --n-border-focus: 1px solid #2563eb !important;
  --n-box-shadow-focus: 0 0 0 2px rgba(37, 99, 235, 0.13) !important;
  background: #fff;
}

:deep(.model-picker-select .n-base-selection) {
  --n-border-hover: 1px solid #bbf7d0 !important;
  --n-border-focus: 1px solid #22c55e !important;
  --n-box-shadow-focus: 0 0 0 2px rgba(34, 197, 94, 0.14) !important;
}

.toolbar + .stats-grid {
  padding-top: 6px;
}

@media (max-width: 720px) {
  .toolbar {
    align-items: stretch;
  }

  .toolbar-filters,
  .toolbar-actions,
  .control-field {
    width: 100%;
  }

  .group-control,
  .model-control {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .control-status {
    grid-column: 2 / -1;
    max-width: none;
    padding-top: 3px;
  }

  .toolbar-actions {
    justify-content: flex-start;
  }

  .group-picker-select,
  .model-picker-select {
    flex: 1;
    min-width: 0;
    width: auto;
  }
}

.btn {
  min-height: 38px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: var(--text-sm);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  background: #fff;
  font-weight: var(--weight-semibold);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
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
  background: #fff;
}

.btn-default:hover:not(:disabled) {
  border-color: #93c5fd;
  color: #1d4ed8;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
}

.btn-success {
  background: #059669;
  border-color: #059669;
  color: #fff;
  box-shadow: 0 10px 22px rgba(5, 150, 105, 0.22);
}

.btn-success:hover:not(:disabled) {
  background: #047857;
  border-color: #047857;
  box-shadow: 0 12px 24px rgba(5, 150, 105, 0.28);
}

.btn-import {
  color: #0f766e;
  border-color: #99f6e4;
  background: linear-gradient(180deg, #f0fdfa 0%, #ccfbf1 100%);
}

.btn-import:hover:not(:disabled) {
  color: #0f5f59;
  border-color: #2dd4bf;
  box-shadow: 0 6px 18px rgba(20, 184, 166, 0.16);
}

.btn-danger-ghost {
  background: #fff;
  color: #dc2626;
  border-color: #fecaca;
}

.btn-danger-ghost:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #fca5a5;
}

.btn-quiet {
  color: #475569;
  border-color: #e2e8f0;
  background: #fff;
}

.btn-quiet:hover:not(:disabled) {
  color: #0f172a;
  border-color: #cbd5e1;
  background: #f8fafc;
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
  font-size: var(--text-xs);
  color: #475569;
  margin-bottom: 4px;
  font-weight: var(--weight-medium);
  white-space: nowrap;
}

.stat-value {
  color: #1e293b;
  font-family: var(--font-number);
  font-size: var(--text-stat);
  font-weight: var(--weight-heavy);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
  line-height: 1.1;
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
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  color: #1e293b;
}

.log-desc {
  font-size: var(--text-sm);
  color: #94a3b8;
  margin-left: 12px;
}

.run-status {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
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
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
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
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
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
  font-size: var(--text-sm);
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 4px;
  margin: 0 0 14px;
  padding: 8px 12px;
}

.config-modal-form {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.config-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.group-sync-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  width: 100%;
  align-items: center;
}

.group-sync-status {
  margin-top: 5px;
  min-height: 18px;
  font-size: var(--text-xs);
  line-height: 18px;
  color: #64748b;
}

.group-sync-status.is-error {
  color: #dc2626;
}

@media (max-width: 520px) {
  .group-sync-field {
    grid-template-columns: 1fr;
  }

  .config-grid {
    grid-template-columns: 1fr;
  }
}

.config-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.config-grid-main,
.config-grid-side {
  min-width: 0;
}

.config-grid-side :deep(.n-input-number) {
  width: 100%;
}

.import-modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.import-target-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid #ccfbf1;
  border-radius: 8px;
  background: #f0fdfa;
}

.import-target-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  color: #0f766e;
}

.import-target-name {
  color: #0f172a;
  font-weight: var(--weight-semibold);
  word-break: break-all;
}

.import-target-count {
  margin-left: auto;
  color: #475569;
  font-size: var(--text-sm);
}

.import-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.95fr);
  gap: 14px;
}

.import-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.import-panel-title {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: #334155;
}

.import-empty {
  min-height: 284px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  color: #94a3b8;
  text-align: center;
}

.import-preview-list {
  max-height: 360px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.import-preview-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.import-preview-item.is-valid {
  border-color: #bbf7d0;
  background: #fbfffd;
}

.import-preview-item.is-invalid {
  border-color: #fecaca;
  background: #fff7f7;
}

.import-preview-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.import-preview-name {
  color: #0f172a;
  font-weight: var(--weight-semibold);
  word-break: break-all;
}

.import-preview-url,
.import-preview-key {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: #64748b;
  word-break: break-all;
}

.import-preview-status {
  white-space: nowrap;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  color: #0f766e;
  background: #ccfbf1;
}

.import-preview-item.is-invalid .import-preview-status {
  color: #b91c1c;
  background: #fee2e2;
}

.import-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}

.import-result-summary {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: #334155;
}

.import-result-list {
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.import-result-item {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) minmax(160px, 0.8fr);
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f8fafc;
  color: #334155;
}

.import-result-status {
  font-weight: var(--weight-bold);
  font-size: var(--text-xs);
}

.import-result-item.is-created .import-result-status {
  color: #16a34a;
}

.import-result-item.is-skipped .import-result-status {
  color: #b45309;
}

.import-result-item.is-failed .import-result-status {
  color: #dc2626;
}

.import-result-url,
.import-result-message {
  min-width: 0;
  word-break: break-all;
}

.import-result-url {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.import-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
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
  font-size: var(--text-sm);
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
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
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

  .import-workspace {
    grid-template-columns: 1fr;
  }

  .import-result-item {
    grid-template-columns: 1fr;
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
