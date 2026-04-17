<template>
  <div class="page-stack page-stack-compact page-container sub2api-page">
    <section class="page-header page-header-spec">
      <div class="page-title page-title-spec">
        <h1 class="main-title">Sub2API 检测</h1>
      </div>
      <p class="page-desc">通过管理员 API Key 批量检测 Sub2API 账户管理中的账号，固定模型为 gpt-5.4。</p>
    </section>

    <n-card :bordered="false" size="small" class="content-card sub2api-card">
      <div class="sub2api-shell">
        <section class="sub2api-panel">
          <div class="sub2api-panel-head">
            <div>
              <h2 class="sub2api-section-title">连接配置</h2>
              <p class="sub2api-section-desc">所有检测请求都由本项目后端发起，页面不会直接暴露 Sub2API 管理员 Key。</p>
            </div>
            <div class="sub2api-chip-row">
              <n-tag round size="small" type="info">鉴权: x-api-key</n-tag>
              <n-tag round size="small" type="success">模型: {{ modelId }}</n-tag>
            </div>
          </div>

          <n-form label-placement="top" autocomplete="off">
            <div class="form-autofill-guard" aria-hidden="true">
              <input type="text" tabindex="-1" autocomplete="username" />
              <input type="password" tabindex="-1" autocomplete="current-password" />
            </div>
            <n-grid :cols="24" :x-gap="14" :y-gap="8">
              <n-gi :span="24" :m="12">
                <n-form-item label="Sub2API 地址">
                  <n-input
                    v-model:value="configForm.baseUrl"
                    placeholder="例如：http://47.251.82.144:8080"
                    :input-props="baseUrlInputProps"
                    @keyup.enter="saveConfig"
                  />
                </n-form-item>
              </n-gi>
              <n-gi :span="24" :m="12">
                <n-form-item label="管理员 API Key">
                  <n-input
                    v-model:value="configForm.adminApiKey"
                    type="password"
                    show-password-on="click"
                    placeholder="请输入 x-api-key"
                    :input-props="apiKeyInputProps"
                    @keyup.enter="saveConfig"
                  />
                </n-form-item>
              </n-gi>
            </n-grid>
          </n-form>

          <div class="sub2api-actions">
            <n-button class="sub2api-action-button" :loading="configSaving" @click="saveConfig">
              保存配置
            </n-button>
            <n-button
              type="primary"
              class="sub2api-action-button"
              :loading="runLoading"
              :disabled="!hasConfiguredSub2Api"
              @click="startDetection"
            >
              开始检测
            </n-button>
            <n-button
              type="error"
              class="sub2api-action-button"
              :loading="deleteLoading"
              :disabled="runLoading || !hasUnauthorizedCandidates"
              @click="clearUnauthorizedAccounts"
            >
              一键清除 401 账号 ({{ unauthorizedCandidates.length }})
            </n-button>
            <n-button class="sub2api-action-button" :disabled="logs.length === 0" @click="clearLogs">
              清空日志
            </n-button>
          </div>
        </section>

        <section class="sub2api-summary-grid">
          <article
            v-for="item in summaryCards"
            :key="item.key"
            class="sub2api-summary-card"
            :class="item.tone ? `sub2api-summary-card-${item.tone}` : ''"
          >
            <span class="sub2api-summary-label">{{ item.label }}</span>
            <strong class="sub2api-summary-value">{{ item.value }}</strong>
          </article>
        </section>

        <section class="sub2api-panel">
          <div class="sub2api-terminal-head">
            <div>
              <h2 class="sub2api-section-title">检测日志</h2>
              <p class="sub2api-section-desc">
                已处理 {{ progress.processedAccounts }} / {{ summary.totalAccounts }}
                <template v-if="progress.currentAccountName">
                  ，当前账号 {{ progress.currentAccountName }}
                </template>
              </p>
            </div>
            <n-tag round size="small" :type="runLoading ? 'warning' : 'default'">
              {{ runLoading ? '检测中' : '待运行' }}
            </n-tag>
          </div>

          <div ref="terminalBodyRef" class="sub2api-terminal">
            <div v-if="logs.length === 0" class="sub2api-terminal-empty">
              检测开始后，日志会实时输出在这里。
            </div>
            <div
              v-for="item in logs"
              :key="item.id"
              class="sub2api-log-line"
              :class="`sub2api-log-line-${item.level}`"
            >
              <span class="sub2api-log-time">{{ formatLogTime(item.timestamp) }}</span>
              <span class="sub2api-log-badge">{{ resolveLevelLabel(item.level) }}</span>
              <span class="sub2api-log-message">{{ item.message }}</span>
            </div>
          </div>
        </section>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton, NCard, NForm, NFormItem, NGi, NGrid, NInput, NTag } from 'naive-ui';
import { useSub2ApiConsole } from '../state/sub2api-console';
import type { Sub2ApiLogLevel } from '../types';

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
  modelId,
  hasConfiguredSub2Api,
  hasUnauthorizedCandidates,
  loadInitialData,
  saveConfig,
  clearLogs,
  startDetection,
  clearUnauthorizedAccounts,
  stopDetection
} = sub2api;

const terminalBodyRef = ref<HTMLElement | null>(null);

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
      tone: ''
    },
    {
      key: 'availableAccounts',
      label: '总可用账号',
      value: summary.availableAccounts,
      tone: 'success'
    },
    {
      key: 'freeAvailableAccounts',
      label: 'Free 可用',
      value: summary.freeAvailableAccounts,
      tone: 'info'
    },
    {
      key: 'plusAvailableAccounts',
      label: 'Plus 可用',
      value: summary.plusAvailableAccounts,
      tone: 'info'
    },
    {
      key: 'teamAvailableAccounts',
      label: 'Team 可用',
      value: summary.teamAvailableAccounts,
      tone: 'info'
    },
    {
      key: 'quotaExhaustedAccounts',
      label: '额度清空数',
      value: summary.quotaExhaustedAccounts,
      tone: 'warning'
    },
    {
      key: 'unauthorizedAccounts',
      label: '401 账号数',
      value: summary.unauthorizedAccounts,
      tone: 'danger'
    },
    {
      key: 'abnormalAccounts',
      label: '异常账号数',
      value: summary.abnormalAccounts,
      tone: 'danger'
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

  if (level === 'warning') {
    return 'WARN';
  }

  if (level === 'error') {
    return 'ERR';
  }

  return 'INFO';
}

async function scrollTerminalToBottom(): Promise<void> {
  await nextTick();
  const element = terminalBodyRef.value;
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
.sub2api-page {
  gap: 0;
}

.main-title {
  margin: 0;
  color: #1e293b;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}

.page-desc {
  margin: 0;
  color: #94a3b8;
  font-size: 14px;
  line-height: 1.6;
}

.sub2api-card :deep(.n-card__content) {
  padding: 24px !important;
}

.sub2api-shell {
  display: grid;
  gap: 20px;
}

.sub2api-panel {
  display: grid;
  gap: 18px;
  padding: 20px 22px;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background:
    radial-gradient(circle at top left, rgba(56, 189, 248, 0.08), transparent 36%),
    linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
}

.sub2api-panel-head,
.sub2api-terminal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.sub2api-section-title {
  margin: 0 0 6px;
  color: #1e293b;
  font-size: 16px;
  font-weight: 600;
}

.sub2api-section-desc {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.7;
}

.sub2api-chip-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sub2api-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.sub2api-action-button {
  min-width: 108px;
}

.sub2api-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.sub2api-summary-card {
  display: grid;
  gap: 10px;
  min-height: 108px;
  padding: 18px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 12px 30px rgba(148, 163, 184, 0.08);
}

.sub2api-summary-card-success {
  border-color: rgba(16, 185, 129, 0.28);
  background: linear-gradient(180deg, rgba(240, 253, 250, 0.96), #ffffff);
}

.sub2api-summary-card-info {
  border-color: rgba(59, 130, 246, 0.2);
  background: linear-gradient(180deg, rgba(239, 246, 255, 0.9), #ffffff);
}

.sub2api-summary-card-warning {
  border-color: rgba(245, 158, 11, 0.24);
  background: linear-gradient(180deg, rgba(255, 251, 235, 0.94), #ffffff);
}

.sub2api-summary-card-danger {
  border-color: rgba(248, 113, 113, 0.22);
  background: linear-gradient(180deg, rgba(254, 242, 242, 0.94), #ffffff);
}

.sub2api-summary-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.sub2api-summary-value {
  color: #0f172a;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
}

.sub2api-terminal {
  overflow: auto;
  min-height: 360px;
  max-height: 520px;
  padding: 16px 18px;
  border-radius: 16px;
  background:
    radial-gradient(circle at top right, rgba(34, 197, 94, 0.12), transparent 28%),
    linear-gradient(180deg, #08111f 0%, #0f172a 52%, #111827 100%);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
}

.sub2api-terminal-empty {
  color: rgba(226, 232, 240, 0.72);
  font-size: 13px;
  line-height: 1.8;
}

.sub2api-log-line {
  display: grid;
  grid-template-columns: 92px 52px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 8px 0;
  color: #e2e8f0;
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
}

.sub2api-log-line + .sub2api-log-line {
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}

.sub2api-log-time {
  color: rgba(148, 163, 184, 0.8);
}

.sub2api-log-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.sub2api-log-message {
  word-break: break-word;
}

.sub2api-log-line-success .sub2api-log-badge {
  background: rgba(34, 197, 94, 0.16);
  color: #86efac;
}

.sub2api-log-line-warning .sub2api-log-badge {
  background: rgba(245, 158, 11, 0.18);
  color: #fcd34d;
}

.sub2api-log-line-error .sub2api-log-badge {
  background: rgba(248, 113, 113, 0.18);
  color: #fca5a5;
}

.sub2api-log-line-success .sub2api-log-message {
  color: #bbf7d0;
}

.sub2api-log-line-warning .sub2api-log-message {
  color: #fde68a;
}

.sub2api-log-line-error .sub2api-log-message {
  color: #fecaca;
}

@media (max-width: 1180px) {
  .sub2api-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .sub2api-panel-head,
  .sub2api-terminal-head,
  .sub2api-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .sub2api-summary-grid {
    grid-template-columns: 1fr;
  }

  .sub2api-log-line {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
</style>
