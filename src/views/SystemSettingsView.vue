<template>
  <div class="page-container settings-page">
    <n-card
      class="main-card settings-card"
      :bordered="false"
      content-style="padding: 0; display: flex; flex-direction: column;"
    >
      <div class="settings-head">
        <div class="settings-tabs" role="tablist" aria-label="系统设置分类">
          <n-button :type="activeTab === 'translation' ? 'primary' : 'default'" @click="activeTab = 'translation'">
            翻译
          </n-button>
          <n-button :type="activeTab === 'backup' ? 'primary' : 'default'" @click="activeTab = 'backup'">
            备份
          </n-button>
          <n-button :type="activeTab === 'externalApi' ? 'primary' : 'default'" @click="activeTab = 'externalApi'">
            接口鉴权
          </n-button>
          <n-button :type="activeTab === 'proxy' ? 'primary' : 'default'" @click="activeTab = 'proxy'">
            代理
          </n-button>
        </div>
        <div v-if="activeTab === 'translation'" class="settings-toolbar">
          <span class="settings-toolbar-label">翻译服务首选项</span>
          <n-select
            v-model:value="form.priorityProvider"
            class="toolbar-priority-select"
            :options="priorityOptions"
            placeholder="选择优先服务"
          />
        </div>
      </div>

      <n-form v-if="activeTab === 'translation'" label-placement="top" autocomplete="off" class="settings-form">
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="username" />
          <input type="password" tabindex="-1" autocomplete="new-password" />
        </div>

        <section class="settings-section">
          <div class="section-title">
            <h3>OpenAI 翻译</h3>
            <span>{{ form.priorityProvider === 'openai' ? '当前优先' : '备用服务' }}</span>
          </div>
          <div class="form-grid">
            <n-form-item label="Base URL">
              <n-input
                v-model:value="form.openaiBaseUrl"
                placeholder="请输入 OpenAI 兼容接口地址"
                :input-props="urlInputProps"
              />
            </n-form-item>
            <n-form-item label="API Key">
              <SecretInput
                v-model:value="form.openaiApiKey"
                placeholder="sk-..."
                :input-props="openAiKeyInputProps"
              />
            </n-form-item>
            <n-form-item label="模型">
              <n-select
                v-model:value="form.openaiModel"
                filterable
                tag
                :options="modelOptions"
                placeholder="gpt-5.4-mini"
              />
            </n-form-item>
          </div>
          <div class="section-actions">
            <n-button :loading="modelLoading" @click="refreshModels">刷新模型列表</n-button>
            <n-button class="translator-test-button" :loading="testingProvider === 'openai'" @click="testProvider('openai')">
              测试 OpenAI
            </n-button>
          </div>
        </section>

        <section class="settings-section">
          <div class="section-title">
            <h3>DeepLX 翻译</h3>
            <span>{{ form.priorityProvider === 'deeplx' ? '当前优先' : '备用服务' }}</span>
          </div>
          <div class="form-grid two-cols">
            <n-form-item label="完整请求地址">
              <n-input
                v-model:value="form.deeplxBaseUrl"
                placeholder="请输入 DeepLX 翻译接口地址"
                :input-props="urlInputProps"
              />
            </n-form-item>
            <n-form-item label="API Key">
              <SecretInput
                v-model:value="form.deeplxApiKey"
                placeholder="可留空；填写后会附加 Bearer 鉴权"
                :input-props="deeplxKeyInputProps"
              />
            </n-form-item>
          </div>
          <div class="section-actions">
            <n-button class="translator-test-button" :loading="testingProvider === 'deeplx'" @click="testProvider('deeplx')">
              测试 DeepLX
            </n-button>
          </div>
        </section>
      </n-form>

      <div v-if="activeTab === 'translation' && testResults.length" class="test-results">
        <div
          v-for="result in testResults"
          :key="`${result.provider}-${result.ok}`"
          class="test-result"
          :class="result.ok ? 'is-ok' : 'is-error'"
        >
          <div class="test-result-title">
            <span>{{ providerLabel(result.provider) }}</span>
            <strong>{{ result.ok ? '可用' : '失败' }}</strong>
          </div>
          <p>{{ result.message }}</p>
          <blockquote v-if="result.translatedText">{{ result.translatedText }}</blockquote>
        </div>
      </div>

      <section v-if="activeTab === 'backup'" class="backup-section">
        <div class="section-title">
          <h3>服务器在线备份</h3>
          <span>不停主项目</span>
        </div>
        <n-alert type="info" :bordered="false" class="backup-alert">
          备份会在线导出当前项目 SQLite、Sub2API PostgreSQL 和 Redis 数据，不会停止望月工具箱。浏览器下载目录请在浏览器设置中设为 D:\aliyun-backups。
        </n-alert>

        <div class="backup-status-grid">
          <div>
            <span class="backup-meta-label">状态</span>
            <n-tag :type="backupTagType" size="small">{{ backupStatusLabel }}</n-tag>
          </div>
          <div>
            <span class="backup-meta-label">文件大小</span>
            <strong>{{ backupJob?.sizeBytes ? formatBytes(backupJob.sizeBytes) : '-' }}</strong>
          </div>
          <div>
            <span class="backup-meta-label">SHA256</span>
            <code>{{ backupJob?.sha256 ? shortenHash(backupJob.sha256) : '-' }}</code>
          </div>
        </div>

        <n-progress
          type="line"
          :percentage="backupJob?.progress ?? 0"
          :processing="backupJob?.status === 'running'"
          :status="backupJob?.status === 'error' ? 'error' : backupJob?.status === 'success' ? 'success' : 'default'"
        />

        <div class="backup-actions">
          <n-button type="primary" :loading="backupStarting" :disabled="backupJob?.status === 'running'" @click="startBackup">
            开始备份
          </n-button>
          <n-button :disabled="backupJob?.status !== 'success'" @click="downloadBackup">下载备份</n-button>
          <n-button :disabled="!backupJob || backupJob.status === 'running'" @click="cleanupBackup">
            清理服务器临时文件
          </n-button>
        </div>

        <div class="backup-log">
          <div class="backup-log-head">
            <strong>备份日志</strong>
            <span>{{ backupJob?.message ?? '尚未开始' }}</span>
          </div>
          <pre>{{ backupLogText }}</pre>
        </div>
      </section>

      <section v-if="activeTab === 'externalApi'" class="backup-section">
        <div class="section-title">
          <h3>开放接口鉴权</h3>
          <span>{{ externalTokenHeader || 'x-mail-api-token' }}</span>
        </div>
        <n-alert type="info" :bordered="false" class="backup-alert">
          该 Key 用于外部系统调用微软邮箱接口，支持请求头 x-mail-api-token 或 Authorization: Bearer。保存后立即生效。
        </n-alert>

        <div class="external-api-panel">
          <n-form label-placement="top" autocomplete="off">
            <n-form-item label="鉴权 Key">
              <SecretInput
                v-model:value="externalApiForm.mailApiToken"
                placeholder="请输入至少 24 位的开放接口鉴权 Key"
                :input-props="externalApiKeyInputProps"
              />
            </n-form-item>
          </n-form>

          <div class="external-api-actions">
            <n-button :loading="externalApiLoading" @click="loadExternalApiConfig">重新载入</n-button>
            <n-button @click="generateExternalApiKey">生成新 Key</n-button>
            <n-button :disabled="!externalApiForm.mailApiToken" @click="copyExternalApiKey">复制 Key</n-button>
            <n-button type="primary" :loading="externalApiSaving" @click="saveExternalApiConfig">保存 Key</n-button>
          </div>
        </div>
      </section>

      <section v-if="activeTab === 'proxy'" class="backup-section">
        <div class="section-title">
          <h3>本地代理</h3>
          <span>{{ proxyForm.proxyUrl ? '已配置' : '未配置' }}</span>
        </div>
        <n-alert type="info" :bordered="false" class="backup-alert">
          公益站签到账号勾选“启用本地代理”后，会通过这里配置的代理请求目标站点；留空则不启用代理。
        </n-alert>

        <div class="external-api-panel">
          <n-form label-placement="top" autocomplete="off">
            <n-form-item label="代理地址">
              <n-input
                v-model:value="proxyForm.proxyUrl"
                placeholder="http://127.0.0.1:7890"
                :input-props="proxyInputProps"
              />
              <template #feedback>当前公益站签到代理支持 http:// 或 https:// 代理地址。</template>
            </n-form-item>
          </n-form>

          <div class="external-api-actions">
            <n-button :loading="proxyLoading" @click="loadProxyConfig">重新载入</n-button>
            <n-button :disabled="!proxyForm.proxyUrl" @click="clearProxyConfig">清空</n-button>
            <n-button type="primary" :loading="proxySaving" @click="saveProxyConfig">保存代理</n-button>
          </div>
        </div>
      </section>

      <div v-if="activeTab === 'translation'" class="settings-footer">
        <n-button :loading="loading" @click="loadConfig">重新载入</n-button>
        <n-button type="primary" :loading="saving" @click="saveConfig">保存配置</n-button>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NProgress,
  NSelect,
  NTag,
  createDiscreteApi
} from 'naive-ui';
import { api } from '../api';
import SecretInput from '../components/SecretInput.vue';
import { copyToClipboard } from '../utils/clipboard';
import { downloadBlob } from '../utils/download';
import type { ExternalApiConfig, SystemBackupJob, SystemProxyConfig, TranslationConfig, TranslationProvider, TranslationTestResult } from '../types';

const { message } = createDiscreteApi(['message']);

const DEFAULT_MODEL = 'gpt-5.4-mini';
const BACKUP_JOB_STORAGE_KEY = 'mail-console-system-backup-job-id';

const form = reactive<TranslationConfig>({
  enabled: true,
  priorityProvider: 'openai',
  openaiBaseUrl: '',
  openaiApiKey: '',
  openaiModel: DEFAULT_MODEL,
  deeplxBaseUrl: '',
  deeplxApiKey: ''
});

const externalApiForm = reactive<ExternalApiConfig>({
  mailApiToken: ''
});

const proxyForm = reactive<SystemProxyConfig>({
  proxyUrl: ''
});

const loading = ref(false);
const saving = ref(false);
const externalApiLoading = ref(false);
const externalApiSaving = ref(false);
const proxyLoading = ref(false);
const proxySaving = ref(false);
const externalTokenHeader = ref('x-mail-api-token');
const modelLoading = ref(false);
const testingProvider = ref<TranslationProvider | ''>('');
const modelItems = ref<string[]>([]);
const testResults = ref<TranslationTestResult[]>([]);
const activeTab = ref<'translation' | 'backup' | 'externalApi' | 'proxy'>('translation');
const backupStarting = ref(false);
const backupJob = ref<SystemBackupJob | null>(null);
let backupPollTimer: number | null = null;
const priorityOptions = [
  { label: 'OpenAI 优先', value: 'openai' },
  { label: 'DeepLX 优先', value: 'deeplx' }
] satisfies Array<{ label: string; value: TranslationProvider }>;

const urlInputProps = {
  spellcheck: false,
  autocomplete: 'off'
};

const openAiKeyInputProps = {
  name: 'translation-openai-api-key',
  autocomplete: 'new-password',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
};

const deeplxKeyInputProps = {
  name: 'translation-deeplx-api-key',
  autocomplete: 'new-password',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
};

const externalApiKeyInputProps = {
  name: 'external-mail-api-token',
  autocomplete: 'new-password',
  spellcheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
};

const proxyInputProps = {
  name: 'system-proxy-url',
  autocomplete: 'off',
  spellcheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
};

const modelOptions = computed(() => {
  const values = [form.openaiModel || DEFAULT_MODEL, DEFAULT_MODEL, ...modelItems.value].filter(Boolean);
  return Array.from(new Set(values)).map((value) => ({
    label: value,
    value
  }));
});

const backupStatusLabel = computed(() => {
  if (!backupJob.value) {
    return '未开始';
  }
  if (backupJob.value.status === 'running') {
    return '备份中';
  }
  if (backupJob.value.status === 'success') {
    return '已完成';
  }
  return '失败';
});

const backupTagType = computed(() => {
  if (!backupJob.value) {
    return 'default';
  }
  if (backupJob.value.status === 'success') {
    return 'success';
  }
  if (backupJob.value.status === 'error') {
    return 'error';
  }
  return 'info';
});

const backupLogText = computed(() => {
  if (!backupJob.value || backupJob.value.logs.length === 0) {
    return '暂无日志';
  }
  return backupJob.value.logs.join('\n');
});

onMounted(() => {
  void loadConfig();
  void loadExternalApiConfig();
  void loadProxyConfig();
  restoreBackupJob();
});

onBeforeUnmount(() => {
  stopBackupPolling();
});

async function loadConfig(): Promise<void> {
  loading.value = true;
  try {
    const { item } = await api.getTranslationConfig();
    assignForm(item);
    testResults.value = [];
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

async function saveConfig(): Promise<void> {
  saving.value = true;
  try {
    const { item } = await api.updateTranslationConfig(normalizeForm());
    assignForm(item);
    message.success('翻译配置已保存');
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function loadExternalApiConfig(): Promise<void> {
  externalApiLoading.value = true;
  try {
    const { item, tokenHeader } = await api.getExternalApiConfig();
    externalApiForm.mailApiToken = item.mailApiToken;
    externalTokenHeader.value = tokenHeader || 'x-mail-api-token';
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    externalApiLoading.value = false;
  }
}

async function saveExternalApiConfig(): Promise<void> {
  externalApiSaving.value = true;
  try {
    const { item } = await api.updateExternalApiConfig({
      mailApiToken: externalApiForm.mailApiToken.trim()
    });
    externalApiForm.mailApiToken = item.mailApiToken;
    message.success('开放接口鉴权 Key 已保存');
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    externalApiSaving.value = false;
  }
}

async function loadProxyConfig(): Promise<void> {
  proxyLoading.value = true;
  try {
    const { item } = await api.getSystemProxyConfig();
    proxyForm.proxyUrl = item.proxyUrl;
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    proxyLoading.value = false;
  }
}

async function saveProxyConfig(): Promise<void> {
  proxySaving.value = true;
  try {
    const { item } = await api.updateSystemProxyConfig({
      proxyUrl: proxyForm.proxyUrl.trim()
    });
    proxyForm.proxyUrl = item.proxyUrl;
    message.success(proxyForm.proxyUrl ? '本地代理已保存' : '本地代理已清空');
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    proxySaving.value = false;
  }
}

function clearProxyConfig(): void {
  proxyForm.proxyUrl = '';
  void saveProxyConfig();
}

function generateExternalApiKey(): void {
  const bytes = new Uint8Array(36);
  crypto.getRandomValues(bytes);
  externalApiForm.mailApiToken = Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  message.success('已生成新 Key，保存后生效');
}

async function copyExternalApiKey(): Promise<void> {
  const token = externalApiForm.mailApiToken.trim();
  if (!token) {
    message.warning('当前没有可复制的 Key');
    return;
  }

  const copied = await copyToClipboard(token);
  if (copied) {
    message.success('Key 已复制');
  } else {
    message.error('复制失败，请检查浏览器权限');
  }
}

async function refreshModels(): Promise<void> {
  modelLoading.value = true;
  try {
    const { items } = await api.listTranslationOpenAiModels(normalizeForm());
    modelItems.value = items;
    if (items.length === 0) {
      message.warning('没有读取到模型列表');
      return;
    }
    message.success(`已读取 ${items.length} 个模型`);
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    modelLoading.value = false;
  }
}

async function testProvider(provider: TranslationProvider): Promise<void> {
  testingProvider.value = provider;
  try {
    const { results } = await api.testTranslationConfig({
      ...normalizeForm(),
      provider
    });
    testResults.value = results;
    const ok = results.some((item) => item.provider === provider && item.ok);
    if (ok) {
      message.success(`${providerLabel(provider)} 测试通过`);
    } else {
      message.error(`${providerLabel(provider)} 测试失败`);
    }
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    testingProvider.value = '';
  }
}

async function startBackup(): Promise<void> {
  backupStarting.value = true;
  try {
    const { item } = await api.createSystemBackup();
    backupJob.value = item;
    localStorage.setItem(BACKUP_JOB_STORAGE_KEY, item.id);
    message.success('已开始备份');
    startBackupPolling(item.id);
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    backupStarting.value = false;
  }
}

async function refreshBackupJob(id: string): Promise<void> {
  try {
    const { item } = await api.getSystemBackupJob(id);
    backupJob.value = item;
    localStorage.setItem(BACKUP_JOB_STORAGE_KEY, item.id);
    if (item.status !== 'running') {
      stopBackupPolling();
      if (item.status === 'success') {
        message.success('备份已完成，可以下载');
      } else {
        message.error(item.error || '备份失败');
      }
    }
  } catch (error) {
    stopBackupPolling();
    localStorage.removeItem(BACKUP_JOB_STORAGE_KEY);
    message.error(getErrorMessage(error));
  }
}

function startBackupPolling(id: string): void {
  stopBackupPolling();
  backupPollTimer = window.setInterval(() => {
    void refreshBackupJob(id);
  }, 1500);
  void refreshBackupJob(id);
}

function stopBackupPolling(): void {
  if (backupPollTimer !== null) {
    window.clearInterval(backupPollTimer);
    backupPollTimer = null;
  }
}

async function downloadBackup(): Promise<void> {
  if (!backupJob.value || backupJob.value.status !== 'success') {
    return;
  }
  try {
    const { blob, filename } = await api.downloadSystemBackup(backupJob.value.id);
    downloadBlob(blob, filename);
  } catch (error) {
    message.error(getErrorMessage(error));
  }
}

async function cleanupBackup(): Promise<void> {
  if (!backupJob.value || backupJob.value.status === 'running') {
    return;
  }
  try {
    await api.cleanupSystemBackup(backupJob.value.id);
    backupJob.value = null;
    localStorage.removeItem(BACKUP_JOB_STORAGE_KEY);
    message.success('服务器临时备份文件已清理');
  } catch (error) {
    message.error(getErrorMessage(error));
  }
}

function restoreBackupJob(): void {
  const jobId = localStorage.getItem(BACKUP_JOB_STORAGE_KEY);
  if (!jobId) {
    return;
  }
  void refreshBackupJob(jobId).then(() => {
    if (backupJob.value?.status === 'running') {
      startBackupPolling(jobId);
    }
  });
}

function assignForm(config: TranslationConfig): void {
  form.enabled = config.enabled;
  form.priorityProvider = config.priorityProvider;
  form.openaiBaseUrl = config.openaiBaseUrl;
  form.openaiApiKey = config.openaiApiKey;
  form.openaiModel = config.openaiModel || DEFAULT_MODEL;
  form.deeplxBaseUrl = config.deeplxBaseUrl;
  form.deeplxApiKey = config.deeplxApiKey;
}

function normalizeForm(): TranslationConfig {
  return {
    enabled: form.enabled,
    priorityProvider: form.priorityProvider,
    openaiBaseUrl: form.openaiBaseUrl.trim(),
    openaiApiKey: form.openaiApiKey.trim(),
    openaiModel: form.openaiModel.trim() || DEFAULT_MODEL,
    deeplxBaseUrl: form.deeplxBaseUrl.trim(),
    deeplxApiKey: form.deeplxApiKey.trim()
  };
}

function providerLabel(provider: TranslationProvider): string {
  return provider === 'openai' ? 'OpenAI' : 'DeepLX';
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function shortenHash(value: string): string {
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}
</script>

<style scoped>
.settings-page {
  display: flex;
  min-height: 100%;
  align-items: flex-start;
  justify-content: center;
}

.settings-card {
  width: min(1000px, 100%);
  overflow: hidden;
  border: 1px solid #dfe4ea !important;
  border-radius: 8px !important;
  background: #ffffff !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03) !important;
}

.settings-head {
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.settings-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}

.settings-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
}

.settings-toolbar-label,
.section-title h3 {
  color: #0f172a;
  font-weight: 700;
}

.settings-toolbar-label {
  font-size: 13px;
}

.toolbar-priority-select {
  width: 200px;
}

.settings-form {
  position: relative;
}

.settings-form :deep(.n-form-item) {
  margin-bottom: 0;
}

.settings-form :deep(.n-form-item-label) {
  min-height: 22px;
  padding-bottom: 7px;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.settings-form :deep(.n-input),
.settings-form :deep(.n-base-selection) {
  --n-height: 38px !important;
  --n-border-radius: 6px !important;
  --n-border: 1px solid #d8dee8 !important;
  --n-border-hover: 1px solid #94a3b8 !important;
  --n-border-focus: 1px solid #3b82f6 !important;
  --n-box-shadow-focus: 0 0 0 2px rgba(59, 130, 246, 0.12) !important;
}

.settings-card :deep(.n-button) {
  min-width: 88px;
  height: 36px;
  border-radius: 6px;
  font-weight: 600;
}

.settings-card :deep(.n-button--primary-type) {
  --n-color: #3b82f6 !important;
  --n-color-hover: #2563eb !important;
  --n-color-pressed: #1d4ed8 !important;
  --n-color-focus: #2563eb !important;
  --n-border: 1px solid #3b82f6 !important;
  --n-border-hover: 1px solid #2563eb !important;
  --n-border-pressed: 1px solid #1d4ed8 !important;
  --n-border-focus: 1px solid #2563eb !important;
}

.form-autofill-guard {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
}

.settings-section {
  padding: 18px 20px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.settings-section:last-child {
  border-bottom: 1px solid #e5e7eb;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.section-title h3 {
  margin: 0;
  font-size: 14px;
}

.section-title span {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #475569;
  font-size: 11px;
  font-weight: 600;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(240px, 1fr) minmax(220px, 1fr);
  gap: 16px;
}

.form-grid.two-cols {
  grid-template-columns: minmax(360px, 1.8fr) minmax(240px, 0.9fr);
}

.section-actions,
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.section-actions {
  margin-top: 12px;
}

.settings-card :deep(.translator-test-button) {
  --n-color: #ffffff !important;
  --n-color-hover: #f8fbff !important;
  --n-color-pressed: #eff6ff !important;
  --n-color-focus: #f8fbff !important;
  --n-text-color: #2563eb !important;
  --n-text-color-hover: #1d4ed8 !important;
  --n-text-color-pressed: #1d4ed8 !important;
  --n-text-color-focus: #1d4ed8 !important;
  --n-border: 1px solid #60a5fa !important;
  --n-border-hover: 1px solid #3b82f6 !important;
  --n-border-pressed: 1px solid #2563eb !important;
  --n-border-focus: 1px solid #3b82f6 !important;
}

.settings-footer {
  padding: 12px 20px;
  border-top: 0;
  background: #ffffff;
}

.test-results {
  display: grid;
  gap: 12px;
  padding: 18px 24px 0;
}

.test-result {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid #dbeafe;
  background: #f8fbff;
}

.test-result.is-error {
  border-color: #fecaca;
  background: #fff7f7;
}

.test-result-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #0f172a;
  font-weight: 700;
}

.test-result p {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 13px;
}

.test-result blockquote {
  margin: 10px 0 0;
  padding-left: 12px;
  border-left: 3px solid #3b82f6;
  color: #1e293b;
  font-size: 13px;
  line-height: 1.7;
}

.backup-section {
  display: grid;
  gap: 16px;
  padding: 18px 20px 20px;
}

.backup-alert {
  border-radius: 6px;
}

.backup-status-grid {
  display: grid;
  grid-template-columns: 0.8fr 1fr 1.5fr;
  gap: 14px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
}

.backup-status-grid > div {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.backup-meta-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.backup-status-grid code {
  overflow: hidden;
  color: #334155;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backup-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.external-api-panel {
  display: grid;
  gap: 16px;
}

.external-api-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.backup-log {
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #0f172a;
}

.backup-log-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  color: #e2e8f0;
  font-size: 12px;
}

.backup-log-head span {
  color: #94a3b8;
}

.backup-log pre {
  min-height: 220px;
  max-height: 360px;
  margin: 0;
  overflow: auto;
  padding: 14px;
  color: #dbeafe;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
}

@media (max-width: 980px) {
  .settings-head,
  .section-actions,
  .settings-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .settings-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-priority-select {
    width: 100%;
  }

  .form-grid,
  .form-grid.two-cols {
    grid-template-columns: 1fr;
  }

  .backup-status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
