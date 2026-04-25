<template>
  <div class="page-container stripe-payment-page">
    <section class="page-header">
      <div>
        <div class="page-title">
          <h1>Stripe支付</h1>
          <span class="tag-pill blue">pay.py</span>
        </div>
        <p class="page-desc">填写 Checkout Session 或支付链接，调用服务端脚本执行 Stripe Checkout 自动化支付。</p>
      </div>
    </section>

    <n-card class="stripe-card" :bordered="false">
      <n-form label-placement="top" autocomplete="off">
        <n-form-item label="Checkout Session / URL" required>
          <n-input
            v-model:value="form.checkoutInput"
            type="textarea"
            placeholder="cs_live_xxx、cs_test_xxx 或脚本支持的 checkout 链接"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </n-form-item>

        <div class="form-grid">
          <n-form-item label="卡索引">
            <n-input-number v-model:value="form.cardIndex" :min="0" :precision="0" placeholder="0" />
          </n-form-item>

          <n-form-item label="配置档案">
            <n-select v-model:value="form.configProfile" :options="configProfileOptions" />
          </n-form-item>
        </div>

        <n-form-item label="手动 hCaptcha Token（可选）">
          <n-input
            v-model:value="form.manualToken"
            type="password"
            show-password-on="click"
            placeholder="留空时由脚本按 config.json 配置处理"
          />
        </n-form-item>

        <div class="action-row">
          <n-button type="primary" :loading="running" @click="handleRun">执行支付脚本</n-button>
          <n-button :disabled="running && !result" @click="handleClear">清空结果</n-button>
        </div>
      </n-form>
    </n-card>

    <n-alert class="security-note" type="warning" :bordered="false">
      该功能会在登录后的服务端环境调用 pay.py。页面不会保存 Token；配置文件路径只允许后端预设档案映射。
    </n-alert>

    <n-card v-if="result" class="result-card" :bordered="false" title="执行结果">
      <div class="result-summary" :class="{ success: result.ok, failed: !result.ok }">
        <span>{{ result.message }}</span>
        <span>退出码：{{ result.exitCode ?? '-' }}</span>
      </div>

      <section v-if="result.stdout" class="output-block">
        <h3>stdout</h3>
        <pre>{{ result.stdout }}</pre>
      </section>

      <section v-if="result.stderr" class="output-block">
        <h3>stderr</h3>
        <pre>{{ result.stderr }}</pre>
      </section>

      <section v-if="result.log" class="output-block">
        <h3>log.txt</h3>
        <pre>{{ result.log }}</pre>
      </section>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import {
  createDiscreteApi,
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect
} from 'naive-ui';
import { api } from '../api';
import type { StripePaymentResponse } from '../types';

const { message } = createDiscreteApi(['message']);

const configProfileOptions = [{ label: 'default (config.json)', value: 'default' }];

const form = reactive({
  checkoutInput: '',
  cardIndex: 0,
  configProfile: 'default',
  manualToken: ''
});

const running = ref(false);
const result = ref<StripePaymentResponse | null>(null);

function normalizeCardIndex(value: number | null): number {
  if (!Number.isFinite(value) || value === null || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

async function handleRun(): Promise<void> {
  const checkoutInput = form.checkoutInput.trim();
  if (!checkoutInput) {
    message.warning('请输入 Checkout Session 或支付链接');
    return;
  }

  running.value = true;
  result.value = null;

  try {
    const response = await api.runStripePayment({
      checkoutInput,
      cardIndex: normalizeCardIndex(form.cardIndex),
      configProfile: form.configProfile,
      manualToken: form.manualToken.trim() || undefined
    });
    result.value = response;
    if (response.ok) {
      message.success(response.message || '支付脚本执行完成');
    } else {
      message.warning(response.message || '支付脚本执行失败');
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '支付脚本执行失败');
  } finally {
    running.value = false;
  }
}

function handleClear(): void {
  result.value = null;
}
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
  align-items: center;
  gap: 12px;
}

.page-title h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
}

.page-desc {
  margin: 8px 0 0;
  color: #667085;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}

.tag-pill.blue {
  color: #175cd3;
  background: #eff8ff;
}

.stripe-card,
.result-card,
.security-note {
  max-width: 980px;
}

.stripe-card,
.result-card {
  border-radius: 16px;
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.08);
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(220px, 1fr);
  gap: 16px;
}

.action-row {
  display: flex;
  gap: 12px;
}

.security-note {
  margin-top: 16px;
}

.result-card {
  margin-top: 16px;
}

.result-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
  font-weight: 700;
}

.result-summary.success {
  color: #067647;
}

.result-summary.failed {
  color: #b42318;
}

.output-block + .output-block {
  margin-top: 16px;
}

.output-block h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #475467;
}

.output-block pre {
  max-height: 360px;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: #101828;
  color: #f9fafb;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 760px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
