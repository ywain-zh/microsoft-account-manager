<template>
  <div class="page-container settings-page">
    <n-card
      class="main-card settings-card"
      :bordered="false"
      content-style="padding: 0; display: flex; flex-direction: column;"
    >
      <div class="settings-head">
        <div>
          <h2>翻译配置</h2>
          <p>非中文邮件会在详情中显示翻译入口，优先使用 OpenAI，失败后自动切换 DeepLX。</p>
        </div>
        <div class="settings-switch-wrap">
          <span>{{ form.enabled ? '启用' : '停用' }}</span>
          <n-switch v-model:value="form.enabled" size="large">
            <template #checked>启用</template>
            <template #unchecked>停用</template>
          </n-switch>
        </div>
      </div>

      <n-form label-placement="top" autocomplete="off" class="settings-form">
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="username" />
          <input type="password" tabindex="-1" autocomplete="new-password" />
        </div>

        <section class="settings-section">
          <div class="section-title">
            <h3>OpenAI 翻译</h3>
            <span>优先调用</span>
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
              <n-input
                v-model:value="form.openaiApiKey"
                type="password"
                show-password-on="click"
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
            <n-button type="primary" ghost :loading="testingProvider === 'openai'" @click="testProvider('openai')">
              测试 OpenAI
            </n-button>
          </div>
        </section>

        <section class="settings-section">
          <div class="section-title">
            <h3>DeepLX 翻译</h3>
            <span>失败兜底</span>
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
              <n-input
                v-model:value="form.deeplxApiKey"
                type="password"
                show-password-on="click"
                placeholder="可留空；填写后会附加 Bearer 鉴权"
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

      <div class="settings-footer">
        <n-button :loading="loading" @click="loadConfig">重新载入</n-button>
        <n-button type="primary" :loading="saving" @click="saveConfig">保存配置</n-button>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
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
  form.openaiBaseUrl = config.openaiBaseUrl;
  form.openaiApiKey = config.openaiApiKey;
  form.openaiModel = config.openaiModel || DEFAULT_MODEL;
  form.deeplxBaseUrl = config.deeplxBaseUrl;
  form.deeplxApiKey = config.deeplxApiKey;
}

function normalizeForm(): TranslationConfig {
  return {
    enabled: form.enabled,
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
  display: flex;
  min-height: 100%;
  align-items: flex-start;
  justify-content: center;
}

.settings-card {
  width: min(1040px, 100%);
  overflow: hidden;
  border: 1px solid #dfe4ea !important;
  border-radius: 8px !important;
  background: #ffffff !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03) !important;
}

.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 92px;
  padding: 22px 24px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.settings-head h2,
.section-title h3 {
  margin: 0;
  color: #0f172a;
  font-weight: 700;
}

.settings-head h2 {
  font-size: 16px;
}

.settings-head p {
  margin: 6px 0 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
}

.settings-switch-wrap {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #10b981;
  font-size: 14px;
  font-weight: 700;
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
  padding: 25px 24px 24px;
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
  margin-bottom: 18px;
}

.section-title h3 {
  font-size: 15px;
}

.section-title span {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef6ff;
  color: #2563eb;
  font-size: 12px;
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
  margin-top: 16px;
}

.settings-footer {
  padding: 18px 24px 16px;
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

@media (max-width: 980px) {
  .settings-head,
  .section-actions,
  .settings-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .form-grid,
  .form-grid.two-cols {
    grid-template-columns: 1fr;
  }
}
</style>
