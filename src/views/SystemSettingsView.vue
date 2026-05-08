<template>
  <div class="page-container settings-page">
    <div class="settings-shell">
      <div class="settings-tabs" aria-label="系统设置分类">
        <span class="settings-tab is-active">翻译配置</span>
      </div>

      <AppListPanel class="main-card settings-card" tone="compact">
        <div class="settings-head">
          <div>
            <h2>翻译配置</h2>
            <p>非中文邮件在详情中显示翻译入口，可选择默认使用的翻译服务。</p>
          </div>
          <n-switch v-model:value="form.enabled" size="large">
            <template #checked>启用</template>
            <template #unchecked>停用</template>
          </n-switch>
        </div>

        <n-form label-placement="top" autocomplete="off" class="settings-form">
          <div class="form-autofill-guard" aria-hidden="true">
            <input type="text" tabindex="-1" autocomplete="username" />
            <input type="password" tabindex="-1" autocomplete="new-password" />
          </div>

          <section class="settings-section provider-section">
            <div class="section-title">
              <h3>优先翻译服务</h3>
            </div>
            <n-radio-group v-model:value="form.preferredProvider" class="provider-toggle">
              <n-radio-button value="openai">OpenAI</n-radio-button>
              <n-radio-button value="deeplx">DeepLX</n-radio-button>
            </n-radio-group>
          </section>

          <section class="settings-section">
            <div class="section-title">
              <h3>OpenAI 翻译</h3>
            </div>
            <div class="form-grid openai-grid">
              <n-form-item label="Base URL">
                <n-input
                  v-model:value="form.openaiBaseUrl"
                  placeholder="请输入 OpenAI 兼容接口地址"
                  :input-props="urlInputProps"
                />
              </n-form-item>
              <n-form-item label="模型">
                <n-select
                  v-model:value="form.openaiModel"
                  filterable
                  tag
                  :options="modelOptions"
                  placeholder="请输入或选择模型"
                />
              </n-form-item>
              <n-form-item class="field-span" label="API Key">
                <n-input
                  v-model:value="form.openaiApiKey"
                  type="password"
                  show-password-on="click"
                  placeholder="请输入 API Key"
                  :input-props="openAiKeyInputProps"
                />
              </n-form-item>
            </div>
            <div class="section-actions">
              <n-button :loading="modelLoading" @click="refreshModels">刷新模型列表</n-button>
              <n-button type="primary" ghost :loading="testingProvider === 'openai'" @click="testProvider('openai')">
                测试 OpenAI
              </n-button>
            </div>
          </section>

          <section class="settings-section">
            <div class="section-title">
              <h3>DeepLX 翻译</h3>
            </div>
            <div class="form-grid deeplx-grid">
              <n-form-item label="完整请求地址">
                <n-input
                  v-model:value="form.deeplxBaseUrl"
                  placeholder="请输入 DeepLX /translate 完整地址"
                  :input-props="urlInputProps"
                />
              </n-form-item>
              <n-form-item label="API Key">
                <n-input
                  v-model:value="form.deeplxApiKey"
                  type="password"
                  show-password-on="click"
                  placeholder="可留空"
                  :input-props="deeplxKeyInputProps"
                />
              </n-form-item>
            </div>
            <div class="section-actions">
              <n-button type="primary" ghost :loading="testingProvider === 'deeplx'" @click="testProvider('deeplx')">
                测试 DeepLX
              </n-button>
            </div>
          </section>
        </n-form>

        <div v-if="testResults.length" class="test-results">
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

        <template #footer>
          <div class="settings-footer">
            <n-button :loading="loading" @click="loadConfig">重新载入</n-button>
            <n-button type="primary" :loading="saving" @click="saveConfig">保存配置</n-button>
          </div>
        </template>
      </AppListPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSwitch,
  createDiscreteApi
} from 'naive-ui';
import { api } from '../api';
import type { TranslationConfig, TranslationProvider, TranslationTestResult } from '../types';

const { message } = createDiscreteApi(['message']);

const DEFAULT_MODEL = 'gpt-5.4-mini';

const form = reactive<TranslationConfig>({
  enabled: false,
  preferredProvider: 'openai',
  openaiBaseUrl: '',
  openaiApiKey: '',
  openaiModel: DEFAULT_MODEL,
  deeplxBaseUrl: '',
  deeplxApiKey: ''
});

const loading = ref(false);
const saving = ref(false);
const modelLoading = ref(false);
const testingProvider = ref<TranslationProvider | ''>('');
const modelItems = ref<string[]>([]);
const testResults = ref<TranslationTestResult[]>([]);

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

const modelOptions = computed(() => {
  const values = [form.openaiModel || DEFAULT_MODEL, DEFAULT_MODEL, ...modelItems.value].filter(Boolean);
  return Array.from(new Set(values)).map((value) => ({
    label: value,
    value
  }));
});

onMounted(() => {
  void loadConfig();
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

function assignForm(config: TranslationConfig): void {
  form.enabled = config.enabled;
  form.preferredProvider = config.preferredProvider ?? 'openai';
  form.openaiBaseUrl = config.openaiBaseUrl;
  form.openaiApiKey = config.openaiApiKey;
  form.openaiModel = config.openaiModel || DEFAULT_MODEL;
  form.deeplxBaseUrl = config.deeplxBaseUrl;
  form.deeplxApiKey = config.deeplxApiKey;
}

function normalizeForm(): TranslationConfig {
  return {
    enabled: form.enabled,
    preferredProvider: form.preferredProvider,
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}
</script>

<style scoped>
.settings-page {
  min-height: 100%;
  background:
    radial-gradient(circle at 34% 0%, rgba(20, 184, 166, 0.1), transparent 28rem),
    linear-gradient(180deg, #f7fbfc 0%, #f8fafc 46%, #ffffff 100%);
}

.settings-shell {
  width: min(100%, 760px);
  margin: 0 auto;
}

.page-header {
  margin-bottom: 18px;
}

.page-header h1 {
  margin: 0 0 8px;
  color: #0f172a;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.25;
}

.page-desc {
  margin: 0;
  color: #7a8db8;
  font-size: 14px;
}

.settings-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 14px;
  padding: 5px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.68);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(14px);
}

.settings-tab {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 13px;
  border-radius: 10px;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
}

.settings-tab.is-active {
  background: #e6fffb;
  color: #0f766e;
  box-shadow: 0 8px 18px rgba(20, 184, 166, 0.1);
}

.main-card {
  border-radius: 18px;
}

.settings-card {
  overflow: hidden;
}

.settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px 10px;
}

.settings-head h2,
.section-title h3 {
  margin: 0;
  color: #0f172a;
  font-weight: 700;
}

.settings-head h2 {
  font-size: 20px;
}

.settings-head p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.settings-form {
  position: relative;
  display: grid;
  gap: 10px;
  padding: 8px 20px 0;
}

.form-autofill-guard {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
}

.settings-section {
  padding: 14px 16px;
  border-radius: 14px;
  background:
    radial-gradient(circle at 0% 0%, rgba(168, 85, 247, 0.08), transparent 42%),
    rgba(255, 255, 255, 0.62);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.045);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.section-title h3 {
  font-size: 16px;
}

.form-grid {
  display: grid;
  gap: 8px 12px;
}

.openai-grid {
  grid-template-columns: minmax(260px, 1fr) minmax(180px, 0.58fr);
}

.deeplx-grid {
  grid-template-columns: minmax(300px, 1fr) minmax(190px, 0.62fr);
}

.field-span {
  grid-column: 1 / -1;
}

.section-actions,
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.section-actions {
  margin-top: 0;
}

.settings-footer {
  padding: 14px 20px 18px;
}

.provider-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.provider-section .section-title {
  margin-bottom: 0;
}

.provider-toggle {
  flex-shrink: 0;
}

.settings-form :deep(.n-form-item) {
  --n-blank-height: 0;
  margin-bottom: 0;
}

.settings-form :deep(.n-form-item-label) {
  min-height: 24px;
  padding-bottom: 3px;
  font-size: 13px;
  font-weight: 650;
}

.settings-form :deep(.n-input),
.settings-form :deep(.n-base-selection) {
  --n-height: 34px;
}

.test-results {
  display: grid;
  gap: 12px;
  padding: 16px 24px 0;
}

.test-result {
  padding: 13px 15px;
  border-radius: 14px;
  background:
    radial-gradient(circle at 0% 0%, rgba(59, 130, 246, 0.08), transparent 42%),
    rgba(248, 251, 255, 0.82);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.test-result.is-error {
  background:
    radial-gradient(circle at 0% 0%, rgba(239, 68, 68, 0.08), transparent 42%),
    rgba(255, 247, 247, 0.86);
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

@media (max-width: 980px) {
  .settings-shell {
    width: 100%;
  }

  .settings-head,
  .section-actions,
  .settings-footer,
  .provider-section {
    align-items: stretch;
    flex-direction: column;
  }

  .form-grid,
  .openai-grid,
  .deeplx-grid {
    grid-template-columns: 1fr;
  }

  .field-span {
    grid-column: auto;
  }
}

@media (max-width: 640px) {
  .settings-head,
  .settings-form,
  .test-results,
  .settings-footer {
    padding-right: 14px;
    padding-left: 14px;
  }

  .settings-tabs {
    width: 100%;
    overflow-x: auto;
  }

  .settings-tab {
    white-space: nowrap;
  }
}
</style>
