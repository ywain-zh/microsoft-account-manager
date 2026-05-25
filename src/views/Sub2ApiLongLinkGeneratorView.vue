<template>
  <div class="page-container long-link-page">
    <n-card
      class="main-card long-link-card"
      :bordered="false"
      content-style="padding: 24px; display: flex; flex-direction: column; gap: 20px;"
    >
      <div class="long-link-toolbar">
        <span class="tag-pill blue">Hosted Checkout</span>
        <span class="long-link-toolbar-copy">无代理时使用服务器本机出口</span>
        <div class="long-link-toolbar-actions">
          <n-button :loading="configLoading" @click="loadConfig">重新载入</n-button>
          <n-button type="primary" :loading="configSaving" @click="saveConfig">保存代理池</n-button>
        </div>
      </div>

      <n-alert type="info" :bordered="false">
        该页面只生成 pay.openai.com 支付长链；代理池为长链生成器专用配置，不影响 Sub2API 检测和重新授权。
      </n-alert>

      <n-form label-placement="top" autocomplete="off" class="long-link-form">
        <div class="long-link-token-head">
          <n-form-item label="Access Token 或 session JSON" class="long-link-token-item">
            <n-input
              v-model:value="form.token"
              type="textarea"
              :autosize="{ minRows: 7, maxRows: 12 }"
              placeholder="可粘贴 accessToken，或 https://chatgpt.com/api/auth/session 返回的整段 JSON"
              @input="updateTokenHint"
            />
          </n-form-item>
          <n-button class="session-copy-button" @click="copySessionUrl">复制 Session 地址</n-button>
        </div>
        <p class="long-link-hint">{{ tokenHint }}</p>

        <div class="long-link-grid">
          <n-form-item label="方案">
            <n-select v-model:value="form.plan" :options="planOptions" />
          </n-form-item>
          <n-form-item label="支付页语言">
            <n-select v-model:value="form.locale" :options="localeOptions" />
          </n-form-item>
          <n-form-item label="地区">
            <n-select v-model:value="form.country" filterable :options="countryOptions" @update:value="updateCurrencyForCountry" />
          </n-form-item>
          <n-form-item label="币种">
            <n-input v-model:value="form.currency" readonly />
          </n-form-item>
        </div>

        <div v-if="form.plan === 'team'" class="long-link-grid">
          <n-form-item label="Team 工作区名称">
            <n-input v-model:value="form.workspaceName" placeholder="linux-do" />
          </n-form-item>
          <n-form-item label="席位数">
            <n-input-number v-model:value="form.seatQuantity" :min="2" :max="1000" />
          </n-form-item>
        </div>

        <n-form-item v-if="form.plan === 'team'" label="Team 优惠码 / 优惠链接">
          <n-input v-model:value="form.promoCode" placeholder="STRIPEATLASGPT4BIZ050126 或 https://chatgpt.com/?promoCode=..." />
        </n-form-item>

        <n-checkbox v-model:checked="form.usePromo">使用优惠参数</n-checkbox>

        <n-form-item label="代理池">
          <n-input
            v-model:value="proxyPool"
            type="textarea"
            :autosize="{ minRows: 6, maxRows: 12 }"
            placeholder="每行一个代理。支持 host:port:user:pass、http(s)://user:pass@host:port、socks5://user:pass@host:port"
          />
        </n-form-item>

        <div class="proxy-actions">
          <n-button :loading="proxyChecking" @click="checkProxy">检测代理 / 本机出口</n-button>
          <n-button :disabled="!proxyPool.trim()" @click="clearProxyPool">清空代理池</n-button>
        </div>

        <div class="proxy-status" :class="{ 'is-error': proxyStatusTone === 'error', 'is-success': proxyStatusTone === 'success' }">
          {{ proxyStatus }}
        </div>

        <div class="long-link-actions">
          <n-button type="primary" size="large" :loading="generating" @click="generateLongLink">生成支付长链</n-button>
          <n-button size="large" :disabled="!resultUrl" @click="copyResultUrl">复制链接</n-button>
          <n-button size="large" :disabled="!resultUrl" @click="openResultUrl">打开链接</n-button>
        </div>
      </n-form>

      <section v-if="resultUrl" class="long-link-result">
        <div class="section-title">
          <h3>生成结果</h3>
          <span>{{ result?.direct ? '本机出口' : result?.proxyUsed || '代理出口' }}</span>
        </div>
        <div class="result-link-row">
          <code>{{ resultUrl }}</code>
          <n-button size="small" @click="copyResultUrl">复制</n-button>
        </div>
        <n-collapse>
          <n-collapse-item title="原始返回" name="raw">
            <pre>{{ rawResultText }}</pre>
          </n-collapse-item>
        </n-collapse>
      </section>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  createDiscreteApi
} from 'naive-ui';
import { api } from '../api';
import type { Sub2ApiLongLinkCheckoutResponse } from '../types';

interface CountryOption {
  label: string;
  value: string;
  currency: string;
}

const { message } = createDiscreteApi(['message']);

const COUNTRY_OPTIONS: CountryOption[] = [
  { label: '美国 US', value: 'US', currency: 'USD' },
  { label: '日本 JP', value: 'JP', currency: 'JPY' },
  { label: '德国 DE', value: 'DE', currency: 'EUR' },
  { label: '法国 FR', value: 'FR', currency: 'EUR' },
  { label: '英国 GB', value: 'GB', currency: 'GBP' },
  { label: '加拿大 CA', value: 'CA', currency: 'CAD' },
  { label: '澳大利亚 AU', value: 'AU', currency: 'AUD' },
  { label: '韩国 KR', value: 'KR', currency: 'KRW' },
  { label: '新加坡 SG', value: 'SG', currency: 'SGD' },
  { label: '中国香港 HK', value: 'HK', currency: 'HKD' },
  { label: '中国台湾 TW', value: 'TW', currency: 'TWD' },
  { label: '印度 IN', value: 'IN', currency: 'INR' },
  { label: '巴西 BR', value: 'BR', currency: 'BRL' },
  { label: '墨西哥 MX', value: 'MX', currency: 'MXN' },
  { label: '泰国 TH', value: 'TH', currency: 'THB' },
  { label: '马来西亚 MY', value: 'MY', currency: 'MYR' },
  { label: '菲律宾 PH', value: 'PH', currency: 'PHP' },
  { label: '越南 VN', value: 'VN', currency: 'VND' },
  { label: '阿联酋 AE', value: 'AE', currency: 'AED' },
  { label: '瑞士 CH', value: 'CH', currency: 'CHF' },
  { label: '瑞典 SE', value: 'SE', currency: 'SEK' },
  { label: '挪威 NO', value: 'NO', currency: 'NOK' },
  { label: '丹麦 DK', value: 'DK', currency: 'DKK' },
  { label: '波兰 PL', value: 'PL', currency: 'PLN' },
  { label: '捷克 CZ', value: 'CZ', currency: 'CZK' },
  { label: '印度尼西亚 ID', value: 'ID', currency: 'IDR' }
];

const planOptions = [
  { label: 'ChatGPT Plus', value: 'plus' },
  { label: 'ChatGPT Team', value: 'team' }
];

const localeOptions = [
  { label: '英文', value: 'en-US' },
  { label: '中文', value: 'zh-CN' },
  { label: '日文', value: 'ja-JP' }
];

const countryOptions = COUNTRY_OPTIONS.map(({ label, value }) => ({ label, value }));
const currencyByCountry = new Map(COUNTRY_OPTIONS.map((item) => [item.value, item.currency]));

const form = reactive({
  token: '',
  plan: 'plus' as 'plus' | 'team',
  locale: 'en-US',
  country: 'US',
  currency: 'USD',
  usePromo: true,
  promoCode: 'STRIPEATLASGPT4BIZ050126',
  workspaceName: 'linux-do',
  seatQuantity: 2
});

const proxyPool = ref('');
const tokenHint = ref('暂未识别 token。');
const proxyStatus = ref('尚未检测。代理池为空时将检测服务器本机出口。');
const proxyStatusTone = ref<'default' | 'success' | 'error'>('default');
const configLoading = ref(false);
const configSaving = ref(false);
const proxyChecking = ref(false);
const generating = ref(false);
const result = ref<Sub2ApiLongLinkCheckoutResponse | null>(null);

const resultUrl = computed(() => result.value?.url || '');
const rawResultText = computed(() => JSON.stringify(result.value?.raw ?? {}, null, 2));

onMounted(() => {
  void loadConfig();
});

async function loadConfig(): Promise<void> {
  configLoading.value = true;
  try {
    const response = await api.getSub2ApiLongLinkConfig();
    proxyPool.value = response.item.proxyPool;
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    configLoading.value = false;
  }
}

async function saveConfig(): Promise<void> {
  configSaving.value = true;
  try {
    const response = await api.updateSub2ApiLongLinkConfig({ proxyPool: proxyPool.value });
    proxyPool.value = response.item.proxyPool;
    message.success('代理池已保存');
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    configSaving.value = false;
  }
}

async function checkProxy(): Promise<void> {
  proxyChecking.value = true;
  proxyStatusTone.value = 'default';
  proxyStatus.value = proxyPool.value.trim() ? '正在检测代理池...' : '正在检测服务器本机出口...';
  try {
    const data = await api.checkSub2ApiLongLinkProxy({ proxyPool: proxyPool.value });
    const location = [data.countryCode, data.country, data.region, data.city].filter(Boolean).join(' / ');
    const isp = data.isp ? `，ISP：${data.isp}` : '';
    const outlet = data.direct ? '服务器本机出口' : `代理出口：${data.proxyUsed}`;
    proxyStatus.value = `${outlet}，IP：${data.ip || '未知'}${location ? '，位置：' + location : ''}${isp}`;
    proxyStatusTone.value = 'success';
  } catch (error) {
    proxyStatus.value = getErrorMessage(error);
    proxyStatusTone.value = 'error';
    message.error(getErrorMessage(error));
  } finally {
    proxyChecking.value = false;
  }
}

async function generateLongLink(): Promise<void> {
  const token = extractToken(form.token);
  if (!token) {
    message.warning('没有识别到 accessToken');
    return;
  }

  generating.value = true;
  result.value = null;
  try {
    result.value = await api.createSub2ApiLongLinkCheckout({
      token,
      plan: form.plan,
      country: form.country,
      currency: form.currency,
      locale: form.locale,
      usePromo: form.usePromo,
      promoCode: form.promoCode,
      workspaceName: form.workspaceName,
      seatQuantity: form.seatQuantity,
      proxyPool: proxyPool.value
    });
    message.success('支付长链已生成');
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    generating.value = false;
  }
}

function updateCurrencyForCountry(country: string): void {
  form.currency = currencyByCountry.get(country) ?? 'USD';
}

function updateTokenHint(): void {
  const token = extractToken(form.token);
  if (!token) {
    tokenHint.value = '暂未识别 token。';
    return;
  }
  const payload = decodeJwtPayload(token);
  const email = payload.email || (payload['https://api.openai.com/profile'] as { email?: string } | undefined)?.email || '';
  tokenHint.value = email ? `已识别 token，可能关联邮箱：${email}` : '已识别 token。';
}

async function copySessionUrl(): Promise<void> {
  await copyText('https://chatgpt.com/api/auth/session', 'Session 地址已复制');
}

async function copyResultUrl(): Promise<void> {
  if (!resultUrl.value) {
    return;
  }
  await copyText(resultUrl.value, '链接已复制');
}

function openResultUrl(): void {
  if (resultUrl.value) {
    window.open(resultUrl.value, '_blank', 'noopener,noreferrer');
  }
}

function clearProxyPool(): void {
  proxyPool.value = '';
  proxyStatus.value = '代理池已清空；生成长链时将使用服务器本机出口。';
  proxyStatusTone.value = 'default';
}

async function copyText(text: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    message.success(successMessage);
  } catch {
    message.error('复制失败，请检查浏览器权限');
  }
}

function extractToken(text: string): string {
  const value = String(text || '').trim();
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    for (const key of ['accessToken', 'access_token', 'token']) {
      const candidate = parsed[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    const data = parsed.data;
    if (data && typeof data === 'object') {
      const candidate = (data as Record<string, unknown>).accessToken;
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    // Fall through to regex extraction.
  }
  return value.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] ?? '';
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(
      decodeURIComponent(Array.from(json).map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}
</script>

<style scoped>
.long-link-card {
  overflow: hidden;
}

.long-link-toolbar,
.long-link-toolbar-actions,
.proxy-actions,
.long-link-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.long-link-toolbar {
  justify-content: space-between;
}

.long-link-toolbar-copy,
.long-link-hint {
  color: var(--muted);
  font-size: 0.9rem;
}

.long-link-toolbar-actions {
  margin-left: auto;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
}

.tag-pill.blue {
  color: #0e7490;
  background: var(--sidebar-accent-soft);
}

.long-link-form {
  display: grid;
  gap: 12px;
}

.long-link-token-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.long-link-token-item {
  margin-bottom: 0;
}

.session-copy-button {
  margin-top: 28px;
}

.long-link-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.proxy-status {
  min-height: 42px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-muted);
  color: var(--muted);
}

.proxy-status.is-success {
  border-color: rgba(22, 163, 74, 0.24);
  background: var(--accent-soft);
  color: #166534;
}

.proxy-status.is-error {
  border-color: rgba(220, 38, 38, 0.24);
  background: var(--danger-soft);
  color: #991b1b;
}

.long-link-result {
  display: grid;
  gap: 14px;
  padding-top: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-title h3 {
  margin: 0;
  color: var(--title);
  font-size: 1rem;
}

.section-title span {
  color: var(--muted);
  font-size: 0.86rem;
}

.result-link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-muted);
}

.result-link-row code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

pre {
  max-height: 360px;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #ffffff;
}

@media (max-width: 760px) {
  .long-link-token-head,
  .long-link-grid,
  .result-link-row {
    grid-template-columns: 1fr;
  }

  .session-copy-button {
    margin-top: 0;
  }
}
</style>
