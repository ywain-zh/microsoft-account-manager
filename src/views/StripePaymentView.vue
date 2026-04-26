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

        <n-form-item label="配置方式">
          <n-radio-group v-model:value="form.configMode" name="stripe-config-mode">
            <n-space>
              <n-radio value="runtime">临时配置</n-radio>
              <n-radio value="default">服务器默认配置</n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>

        <template v-if="form.configMode === 'runtime'">
          <n-form-item label="ClientKey / YesCaptcha API Key" required>
            <n-input
              v-model:value="form.clientKey"
              type="password"
              show-password-on="click"
              placeholder="本次运行使用，不会保存"
            />
          </n-form-item>

          <n-form-item label="卡信息" required>
            <n-input
              v-model:value="form.cardLine"
              type="textarea"
              placeholder="卡号 ---- MM/YY ---- CVC ---- 手机号 ---- 短信接口URL ---- 姓名 ---- 地址"
              :autosize="{ minRows: 3, maxRows: 6 }"
            />
          </n-form-item>

          <n-form-item label="备用 publishable key（可选）">
            <n-input
              v-model:value="form.publishableKey"
              type="password"
              show-password-on="click"
              placeholder="pk_live_... 或 pk_test_...；留空使用内置/自动探测"
            />
          </n-form-item>
        </template>

        <template v-else>
          <div class="form-grid">
            <n-form-item label="卡索引">
              <n-input-number v-model:value="form.cardIndex" :min="0" :precision="0" placeholder="0" />
            </n-form-item>

            <n-form-item label="配置档案">
              <n-select v-model:value="form.configProfile" :options="configProfileOptions" />
            </n-form-item>
          </div>
        </template>

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
          <n-button :disabled="running && !runLog" @click="handleClear">清空结果</n-button>
        </div>
      </n-form>
    </n-card>

    <n-card class="stripe-card proxy-card" :bordered="false" title="代理配置">
      <n-form label-placement="top" autocomplete="off">
        <n-form-item label="是否启用代理">
          <n-switch v-model:value="proxyForm.enabled" />
        </n-form-item>

        <div class="form-grid">
          <n-form-item label="代理协议">
            <n-select v-model:value="proxyForm.protocol" :options="proxyProtocolOptions" />
          </n-form-item>

          <n-form-item label="代理格式粘贴">
            <n-input-group>
              <n-input
                v-model:value="proxyForm.proxyLine"
                placeholder="host:port:user:pass"
              />
              <n-button @click="handleParseProxyLine">解析</n-button>
            </n-input-group>
          </n-form-item>
        </div>

        <div class="form-grid proxy-grid">
          <n-form-item label="Host">
            <n-input v-model:value="proxyForm.host" placeholder="us.rrp.b2proxy.com" />
          </n-form-item>

          <n-form-item label="Port">
            <n-input-number v-model:value="proxyForm.port" :min="1" :max="65535" :precision="0" placeholder="10000" />
          </n-form-item>

          <n-form-item label="User">
            <n-input v-model:value="proxyForm.user" placeholder="USER844093-zone-custom-region-US" />
          </n-form-item>

          <n-form-item label="Password">
            <n-input v-model:value="proxyForm.pass" type="password" show-password-on="click" placeholder="代理密码" />
          </n-form-item>
        </div>

        <div class="action-row">
          <n-button type="primary" :loading="savingProxy" @click="handleSaveProxyConfig">保存代理配置</n-button>
          <n-button :loading="testingProxy" @click="handleTestProxyConfig">测试代理</n-button>
        </div>
      </n-form>
    </n-card>

    <n-alert class="security-note" type="warning" :bordered="false">
      该功能会在登录后的服务端环境调用 pay.py。页面不会保存 Token、ClientKey、卡号、CVC 或备用 publishable key；代理配置会按你的要求保存到服务端并用于后续运行。
    </n-alert>

    <n-card v-if="running || runLog" class="result-card" :bordered="false" title="执行结果 / 实时日志">
      <div class="result-summary" :class="{ success: runLog?.status === 'completed', failed: isFailedStatus }">
        <span>{{ runLog?.message || '支付脚本运行中' }}</span>
        <span>状态：{{ runLog?.status || 'running' }}</span>
        <span>退出码：{{ runLog?.exitCode ?? '-' }}</span>
      </div>

      <section v-if="runLog?.stdout" class="output-block">
        <h3>stdout</h3>
        <pre>{{ runLog.stdout }}</pre>
      </section>

      <section v-if="runLog?.stderr" class="output-block">
        <h3>stderr</h3>
        <pre>{{ runLog.stderr }}</pre>
      </section>

      <section class="output-block">
        <h3>log.txt</h3>
        <pre>{{ runLog?.log || '等待日志输出...' }}</pre>
      </section>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
  createDiscreteApi,
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputGroup,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch
} from 'naive-ui';
import { api } from '../api';
import type { StripePaymentRunLogResponse, StripeProxyConfig } from '../types';

const { message } = createDiscreteApi(['message']);

const configProfileOptions = [{ label: 'default (config.json)', value: 'default' }];
const proxyProtocolOptions = [
  { label: 'HTTPS', value: 'https' },
  { label: 'socket5 / SOCKS5', value: 'socks5' }
];

const form = reactive({
  checkoutInput: '',
  configMode: 'runtime' as 'runtime' | 'default',
  cardIndex: 0,
  configProfile: 'default',
  clientKey: '',
  cardLine: '',
  publishableKey: '',
  manualToken: ''
});

const running = ref(false);
const savingProxy = ref(false);
const testingProxy = ref(false);
const runLog = ref<StripePaymentRunLogResponse | null>(null);
let pollTimer: number | undefined;

const proxyForm = reactive<StripeProxyConfig>({
  enabled: false,
  protocol: 'https',
  proxyLine: '',
  host: '',
  port: null,
  user: '',
  pass: ''
});

const isFailedStatus = computed(() =>
  runLog.value?.status === 'failed' || runLog.value?.status === 'timeout'
);

function normalizeCardIndex(value: number | null): number {
  if (!Number.isFinite(value) || value === null || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

function applyProxyConfig(config: StripeProxyConfig): void {
  proxyForm.enabled = config.enabled;
  proxyForm.protocol = config.protocol;
  proxyForm.proxyLine = config.proxyLine || '';
  proxyForm.host = config.host;
  proxyForm.port = config.port;
  proxyForm.user = config.user;
  proxyForm.pass = config.pass;
}

async function loadProxyConfig(): Promise<void> {
  try {
    const response = await api.getStripePaymentProxyConfig();
    applyProxyConfig(response.item);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取代理配置失败');
  }
}

function handleParseProxyLine(): void {
  const parts = (proxyForm.proxyLine || '').trim().split(':');
  if (parts.length < 2) {
    message.warning('代理格式必须为 host:port:user:pass');
    return;
  }

  const port = Number(parts[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    message.warning('代理端口必须是 1 到 65535 的整数');
    return;
  }

  proxyForm.host = parts[0].trim();
  proxyForm.port = port;
  proxyForm.user = parts[2]?.trim() || '';
  proxyForm.pass = parts.slice(3).join(':').trim();
  proxyForm.enabled = true;
  message.success('代理信息已解析');
}

async function handleSaveProxyConfig(): Promise<void> {
  savingProxy.value = true;
  try {
    const response = await api.updateStripePaymentProxyConfig({ ...proxyForm });
    applyProxyConfig(response.item);
    message.success('代理配置已保存');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存代理配置失败');
  } finally {
    savingProxy.value = false;
  }
}

async function handleTestProxyConfig(): Promise<void> {
  testingProxy.value = true;
  try {
    const response = await api.testStripePaymentProxyConfig({ ...proxyForm });
    if (response.ok) {
      message.success(response.ip ? `${response.message} (${response.ip})` : response.message);
    } else {
      message.warning(response.message);
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '代理测试失败');
  } finally {
    testingProxy.value = false;
  }
}

async function handleRun(): Promise<void> {
  const checkoutInput = form.checkoutInput.trim();
  if (!checkoutInput) {
    message.warning('请输入 Checkout Session 或支付链接');
    return;
  }

  const publishableKey = form.publishableKey.trim();
  if (publishableKey && !/^pk_(?:live|test)_[A-Za-z0-9]+$/.test(publishableKey)) {
    message.warning('备用 publishable key 必须以 pk_live_ 或 pk_test_ 开头');
    return;
  }

  if (form.configMode === 'runtime') {
    if (!form.clientKey.trim()) {
      message.warning('请输入 ClientKey');
      return;
    }
    if (!form.cardLine.trim()) {
      message.warning('请输入卡信息');
      return;
    }
  }

  stopPolling();
  running.value = true;
  runLog.value = null;

  try {
    const response = await api.runStripePayment({
      checkoutInput,
      manualToken: form.manualToken.trim() || undefined,
      ...(form.configMode === 'runtime'
        ? {
            runtimeConfig: {
              clientKey: form.clientKey.trim(),
              cardLine: form.cardLine.trim(),
              publishableKey: publishableKey || undefined
            }
          }
        : {
            cardIndex: normalizeCardIndex(form.cardIndex),
            configProfile: form.configProfile
          })
    });
    await pollRunLog(response.runId);
    pollTimer = window.setInterval(() => {
      void pollRunLog(response.runId);
    }, 1000);
  } catch (error) {
    running.value = false;
    message.error(error instanceof Error ? error.message : '支付脚本执行失败');
  }
}

async function pollRunLog(runId: string): Promise<void> {
  try {
    const response = await api.getStripePaymentRunLog(runId);
    runLog.value = response;
    if (response.status !== 'running') {
      running.value = false;
      stopPolling();
      if (response.status === 'completed') {
        message.success(response.message || '支付脚本执行完成');
      } else {
        message.warning(response.message || '支付脚本执行失败');
      }
    }
  } catch (error) {
    running.value = false;
    stopPolling();
    message.error(error instanceof Error ? error.message : '读取支付日志失败');
  }
}

function handleClear(): void {
  if (!running.value) {
    runLog.value = null;
  }
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

onMounted(() => {
  void loadProxyConfig();
});

onBeforeUnmount(() => {
  stopPolling();
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
.proxy-card,
.result-card,
.security-note {
  max-width: 980px;
}

.stripe-card,
.proxy-card,
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

.proxy-card,
.result-card {
  margin-top: 16px;
}

.proxy-grid {
  grid-template-columns: repeat(2, minmax(180px, 1fr));
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
