<template>
  <div class="page-container long-link-page">
    <n-card
      class="main-card proxy-overview-card"
      :bordered="false"
      content-style="padding: 16px;"
    >
      <section class="proxy-status-panel" :class="{ 'is-error': proxyStatusTone === 'error', 'is-success': proxyStatusTone === 'success' }">
        <div class="proxy-status-line">
          <span class="proxy-status-dot" aria-hidden="true"></span>
          <p>
            <strong>代理状态：</strong>
            <span>{{ proxyStatus }}</span>
          </p>
        </div>
        <n-button attr-type="button" type="primary" class="proxy-config-button" @click="openProxyModal">代理配置</n-button>
      </section>
    </n-card>

    <n-card
      class="main-card long-link-card"
      :bordered="false"
      content-style="padding: 0;"
    >
      <n-form label-placement="top" autocomplete="off" class="long-link-form">
        <section class="long-link-token-section">
          <div class="long-link-section-head">
            <h2>Access Token 或 Session JSON</h2>
            <n-button attr-type="button" class="session-copy-button" @click="copySessionUrl">复制 Session 地址</n-button>
          </div>
          <n-form-item class="long-link-token-item">
            <n-input
              v-model:value="form.token"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 9 }"
              placeholder="可粘贴 accessToken，或 https://chatgpt.com/api/auth/session 返回的整段 JSON"
              @input="updateTokenHint"
            />
          </n-form-item>
          <p class="long-link-hint">{{ tokenHint }}</p>
        </section>

        <section class="long-link-options-section">
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
        </section>

        <section class="long-link-submit-section">
          <n-checkbox v-model:checked="form.usePromo">使用优惠参数</n-checkbox>

          <div class="long-link-actions">
            <n-button attr-type="button" size="large" :disabled="!resultUrl" @click="copyResultUrl">复制链接</n-button>
            <n-button attr-type="button" size="large" :disabled="!resultUrl" @click="openResultUrl">打开链接</n-button>
            <n-button attr-type="button" type="primary" size="large" :loading="generating" @click="generateLongLink">生成支付长链</n-button>
          </div>
        </section>
      </n-form>

      <section v-if="resultUrl" class="long-link-result">
        <div class="section-title">
          <h3>生成结果</h3>
          <span>{{ result?.direct ? '本机出口' : result?.proxyUsed || '代理出口' }}</span>
        </div>
        <div class="result-link-row">
          <code>{{ resultUrl }}</code>
            <n-button attr-type="button" size="small" @click="copyResultUrl">复制</n-button>
        </div>
        <n-collapse>
          <n-collapse-item title="原始返回" name="raw">
            <pre>{{ rawResultText }}</pre>
          </n-collapse-item>
        </n-collapse>
      </section>
    </n-card>

    <n-modal
      v-model:show="showProxyModal"
      preset="card"
      title="代理配置"
      class="proxy-config-modal"
      style="width: min(768px, 94vw); border-radius: 14px;"
      :mask-closable="false"
    >
      <div class="proxy-config-body">
        <n-form label-placement="top">
          <n-form-item label="代理池节点">
            <n-input
              v-model:value="proxyDraft"
              type="textarea"
              :autosize="{ minRows: 6, maxRows: 8 }"
              placeholder="每行一个代理，支持 host:port:user:pass、host:port、user:pass@host:port、http://host:port、socks5://host:port"
            />
          </n-form-item>
        </n-form>

        <div class="proxy-config-actions">
          <n-button attr-type="button" :loading="configLoading" @click.stop.prevent="loadConfigIntoDraft">重新载入</n-button>
          <n-button attr-type="button" :loading="proxyChecking" @click.stop.prevent="testAllProxyItems">测试全部</n-button>
          <n-button attr-type="button" @click.stop.prevent="importProxyDraft">导入</n-button>
          <n-button attr-type="button" :disabled="proxyItems.length === 0" @click.stop.prevent="removeAllProxyItems">全部删除</n-button>
          <n-button attr-type="button" type="primary" :loading="configSaving" @click.stop.prevent="saveProxyConfig">保存代理池</n-button>
        </div>

        <div class="proxy-item-list">
          <div v-if="proxyItems.length === 0" class="proxy-empty">未配置代理，长链生成时将使用服务器本机出口。</div>
          <div v-for="(item, index) in proxyItems" :key="`${item.raw}-${index}`" class="proxy-item">
            <div class="proxy-item-main">
              <strong>{{ item.hostPort }}</strong>
              <div class="proxy-item-meta">
                <span v-if="item.region" class="proxy-meta-chip">{{ item.region }}</span>
                <span class="proxy-meta-chip">{{ item.protocol }}</span>
                <span v-if="item.identity" class="proxy-meta-divider"></span>
                <span v-if="item.identity" class="proxy-item-identity">{{ item.identity }}</span>
                <span class="proxy-meta-dot"></span>
                <span :class="resolveProxyItemTone(item)">{{ item.statusText }}</span>
              </div>
            </div>
            <div class="proxy-item-actions">
              <n-button attr-type="button" size="small" :loading="item.testing" @click.stop.prevent="testProxyItem(index)">测试</n-button>
              <n-button attr-type="button" size="small" type="error" secondary @click.stop.prevent="removeProxyItem(index)">删除</n-button>
            </div>
          </div>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NCard,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  createDiscreteApi
} from 'naive-ui';
import { api } from '../api';
import type { Sub2ApiLongLinkCheckoutResponse, Sub2ApiLongLinkProxyCheckResponse } from '../types';

interface CountryOption {
  label: string;
  value: string;
  currency: string;
}

interface ProxyListItem {
  raw: string;
  display: string;
  hostPort: string;
  region: string;
  protocol: string;
  identity: string;
  testing: boolean;
  ok: boolean | null;
  statusText: string;
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
const proxyDraft = ref('');
const proxyItems = ref<ProxyListItem[]>([]);
const showProxyModal = ref(false);
const tokenHint = ref('暂未识别 token。');
const proxyStatus = ref('未检查代理状态；代理池为空时将使用服务器本机出口。');
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
    proxyDraft.value = proxyPool.value;
    proxyItems.value = parseProxyItems(proxyPool.value);
    setProxyStatusFromPool();
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    configLoading.value = false;
  }
}

async function saveProxyConfig(): Promise<void> {
  configSaving.value = true;
  try {
    syncProxyPoolFromItems();
    const response = await api.updateSub2ApiLongLinkConfig({ proxyPool: proxyPool.value });
    proxyPool.value = response.item.proxyPool;
    proxyDraft.value = '';
    proxyItems.value = parseProxyItems(proxyPool.value);
    setProxyStatusFromPool('saved');
    message.success('代理池已保存');
  } catch (error) {
    message.error(getErrorMessage(error));
  } finally {
    configSaving.value = false;
  }
}

async function checkProxy(pool = proxyPool.value): Promise<Sub2ApiLongLinkProxyCheckResponse | null> {
  proxyChecking.value = true;
  proxyStatusTone.value = 'default';
  proxyStatus.value = pool.trim() ? '正在检查代理池是否生效...' : '正在检查服务器本机出口...';
  try {
    const data = await api.checkSub2ApiLongLinkProxy({ proxyPool: pool });
    const location = [data.countryCode, data.country, data.region, data.city].filter(Boolean).join(' / ');
    const isp = data.isp ? `，ISP：${data.isp}` : '';
    const outlet = data.direct ? '未启用代理池，当前使用服务器本机出口' : `代理池已生效，当前出口 ${maskProxyForDisplay(data.proxyUsed)}`;
    proxyStatus.value = `${outlet}，IP：${data.ip || '未知'}${location ? '，位置：' + location : ''}${isp}`;
    proxyStatusTone.value = 'success';
    return data;
  } catch (error) {
    proxyStatus.value = `代理池未生效：${getErrorMessage(error)}`;
    proxyStatusTone.value = 'error';
    message.error(getErrorMessage(error));
    return null;
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

function openProxyModal(): void {
  proxyDraft.value = proxyPool.value;
  proxyItems.value = parseProxyItems(proxyPool.value);
  showProxyModal.value = true;
}

function loadConfigIntoDraft(): void {
  void loadConfig();
}

function importProxyDraft(): void {
  const merged = [...proxyItems.value, ...parseProxyItems(proxyDraft.value)];
  const seen = new Set<string>();
  proxyItems.value = merged.filter((item) => {
    const key = item.raw.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  syncProxyDraftFromItems();
  message.success(`已导入 ${proxyItems.value.length} 条代理`);
}

function removeProxyItem(index: number): void {
  proxyItems.value.splice(index, 1);
  syncProxyDraftFromItems();
}

function removeAllProxyItems(): void {
  proxyItems.value = [];
  proxyDraft.value = '';
}

async function testProxyItem(index: number): Promise<void> {
  const item = proxyItems.value[index];
  if (!item) {
    return;
  }
  item.testing = true;
  item.statusText = '测试中...';
  try {
    const data = await api.checkSub2ApiLongLinkProxy({ proxyPool: item.raw });
    const location = formatProxyLocation(data);
    item.ok = true;
    item.statusText = `${data.ip || '未知 IP'}${location ? ' · ' + location : ''}`;
  } catch (error) {
    item.ok = false;
    item.statusText = getErrorMessage(error);
  } finally {
    item.testing = false;
  }
}

async function testAllProxyItems(): Promise<void> {
  mergeProxyDraftIntoItems();
  if (proxyItems.value.length === 0) {
    syncProxyPoolFromItems();
    await checkProxy(proxyPool.value);
    return;
  }

  proxyChecking.value = true;
  proxyStatusTone.value = 'default';
  proxyStatus.value = `正在测试全部代理，共 ${proxyItems.value.length} 条...`;

  try {
    let firstSuccess: Sub2ApiLongLinkProxyCheckResponse | null = null;
    for (let index = 0; index < proxyItems.value.length; index += 1) {
      const item = proxyItems.value[index];
      item.testing = true;
      item.statusText = '测试中...';
      try {
        const data = await api.checkSub2ApiLongLinkProxy({ proxyPool: item.raw });
        const location = formatProxyLocation(data);
        item.ok = true;
        item.statusText = `${data.ip || '未知 IP'}${location ? ' · ' + location : ''}`;
        firstSuccess ??= data;
      } catch (error) {
        item.ok = false;
        item.statusText = getErrorMessage(error);
      } finally {
        item.testing = false;
      }
    }

    const successCount = proxyItems.value.filter((item) => item.ok === true).length;
    const failedCount = proxyItems.value.filter((item) => item.ok === false).length;
    if (firstSuccess) {
      const location = formatProxyLocation(firstSuccess);
      proxyStatus.value = `代理池已生效，${successCount} 条可用，${failedCount} 条失败；当前可用出口 ${maskProxyForDisplay(firstSuccess.proxyUsed)}，IP：${firstSuccess.ip || '未知'}${location ? '，位置：' + location : ''}`;
      proxyStatusTone.value = 'success';
    } else {
      proxyStatus.value = `代理池未生效：全部 ${failedCount} 条代理测试失败。`;
      proxyStatusTone.value = 'error';
    }
  } finally {
    proxyChecking.value = false;
  }
}

function formatProxyLocation(data: Sub2ApiLongLinkProxyCheckResponse): string {
  return [data.countryCode, data.country, data.region, data.city].filter(Boolean).join(' / ');
}

function mergeProxyDraftIntoItems(): void {
  const draftItems = parseProxyItems(proxyDraft.value);
  if (draftItems.length === 0) {
    return;
  }

  const seen = new Set(proxyItems.value.map((item) => item.raw.toLowerCase()));
  const additions = draftItems.filter((item) => {
    const key = item.raw.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  if (additions.length > 0) {
    proxyItems.value = [...proxyItems.value, ...additions];
    syncProxyDraftFromItems();
  }
}

function parseProxyItems(text: string): ProxyListItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      const display = formatProxyLine(raw);
      return {
        raw,
        display,
        ...parseProxyDisplayParts(raw),
        testing: false,
        ok: null,
        statusText: '未测试'
      };
    });
}

function syncProxyDraftFromItems(): void {
  proxyDraft.value = proxyItems.value.map((item) => item.raw).join('\n');
}

function syncProxyPoolFromItems(): void {
  const fromItems = proxyItems.value.map((item) => item.raw).join('\n').trim();
  proxyPool.value = fromItems || proxyDraft.value.trim();
}

function setProxyStatusFromPool(mode: 'loaded' | 'saved' = 'loaded'): void {
  const count = proxyItems.value.length;
  proxyStatusTone.value = 'default';
  if (count === 0) {
    proxyStatus.value = `${mode === 'saved' ? '代理池已保存为空' : '未配置代理池'}，长链生成时将使用服务器本机出口。`;
    return;
  }
  proxyStatus.value = `${mode === 'saved' ? '代理池已保存' : '代理池已载入'}，共 ${count} 条；点击“测试全部”确认代理池是否生效。`;
}

function resolveProxyItemTone(item: ProxyListItem): string {
  if (item.ok === true) {
    return 'is-success';
  }
  if (item.ok === false) {
    return 'is-error';
  }
  return '';
}

function formatProxyLine(raw: string): string {
  const line = raw.trim();
  const withoutProtocol = line.replace(/^[a-z0-9+.-]+:\/\//i, '');
  const authAtIndex = withoutProtocol.lastIndexOf('@');
  const visible = authAtIndex >= 0 ? `${maskProxyAuth(withoutProtocol.slice(0, authAtIndex))}@${withoutProtocol.slice(authAtIndex + 1)}` : maskLajiaoProxy(withoutProtocol);
  const protocol = /^[a-z0-9+.-]+:\/\//i.exec(line)?.[0]?.replace('://', '').toUpperCase() || 'HTTP';
  return `${visible} · ${protocol}`;
}

function parseProxyDisplayParts(raw: string): Pick<ProxyListItem, 'hostPort' | 'region' | 'protocol' | 'identity'> {
  const line = raw.trim();
  const protocol = /^[a-z0-9+.-]+:\/\//i.exec(line)?.[0]?.replace('://', '').toUpperCase() || 'HTTP';
  const withoutProtocol = line.replace(/^[a-z0-9+.-]+:\/\//i, '');
  const authAtIndex = withoutProtocol.lastIndexOf('@');
  const addressPart = authAtIndex >= 0 ? withoutProtocol.slice(authAtIndex + 1) : withoutProtocol;
  const authPart = authAtIndex >= 0 ? withoutProtocol.slice(0, authAtIndex) : '';
  const lajiaoParts = addressPart.split(':');

  if (authAtIndex >= 0) {
    const [host = '', port = ''] = addressPart.split(':');
    return {
      hostPort: port ? `${host}:${port}` : host,
      region: parseRegion(authPart),
      protocol,
      identity: maskProxyAuth(authPart)
    };
  }

  if (lajiaoParts.length >= 4) {
    const [host, port, user] = lajiaoParts;
    return {
      hostPort: `${host}:${port}`,
      region: parseRegion(user),
      protocol,
      identity: maskMiddle(user)
    };
  }

  return {
    hostPort: addressPart,
    region: parseRegion(addressPart),
    protocol,
    identity: ''
  };
}

function parseRegion(value: string): string {
  return value.match(/region-([A-Za-z]+)/)?.[1]?.toUpperCase() || '';
}

function maskProxyAuth(auth: string): string {
  const [user = '', password = ''] = auth.split(':');
  return `${maskMiddle(user)}:${password ? '***' : ''}`;
}

function maskLajiaoProxy(value: string): string {
  const parts = value.split(':');
  if (parts.length >= 4) {
    const [host, port, user] = parts;
    const region = user.match(/region-([A-Za-z]+)/)?.[1];
    return `${host}:${port}${region ? ` · ${region}` : ''} · ${maskMiddle(user)}`;
  }
  return value;
}

function maskProxyForDisplay(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/i, '$1***$3');
}

function maskMiddle(value: string): string {
  if (value.length <= 8) {
    return value ? `${value.slice(0, 2)}***` : '';
  }
  return `${value.slice(0, 3)}***${value.slice(-4)}`;
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
.long-link-page {
  max-width: 1152px;
  margin: 0 auto;
}

.proxy-overview-card,
.long-link-card {
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
}

.long-link-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.long-link-hint {
  color: var(--muted);
  font-size: 0.9rem;
}

.long-link-form {
  display: grid;
  gap: 0;
}

.long-link-token-section,
.long-link-options-section,
.long-link-submit-section {
  padding: 24px;
}

.long-link-options-section,
.long-link-submit-section {
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

.long-link-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.long-link-section-head h2 {
  margin: 0;
  color: var(--title);
  font-size: 1.02rem;
  font-weight: 700;
}

.long-link-token-item {
  margin-bottom: 0;
}

.session-copy-button {
  flex-shrink: 0;
}

.long-link-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}

.proxy-status-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 36px;
  color: var(--muted);
}

.proxy-status-panel.is-success {
  color: #166534;
}

.proxy-status-panel.is-error {
  color: #991b1b;
}

.proxy-status-line {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.proxy-status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #60a5fa;
}

.proxy-status-panel.is-success .proxy-status-dot {
  background: var(--accent);
}

.proxy-status-panel.is-error .proxy-status-dot {
  background: #dc2626;
}

.proxy-status-line p {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.proxy-status-line strong {
  color: var(--title);
  font-weight: 700;
}

.proxy-config-button {
  min-width: 112px;
}

.long-link-result {
  display: grid;
  gap: 14px;
  padding: 0 24px 24px;
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

.proxy-config-body {
  display: grid;
  gap: 24px;
}

.proxy-config-actions,
.proxy-item-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.proxy-config-actions {
  justify-content: flex-end;
  padding-bottom: 2px;
}

.proxy-item-list {
  display: grid;
  gap: 14px;
  max-height: min(48vh, 520px);
  overflow: auto;
  padding: 20px 0 2px;
  border-top: 1px dashed rgba(148, 163, 184, 0.38);
}

.proxy-empty,
.proxy-item {
  border: 1px solid rgba(226, 232, 240, 0.96);
  border-radius: 8px;
  background: #ffffff;
}

.proxy-empty {
  padding: 16px;
  color: var(--muted);
}

.proxy-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  min-height: 80px;
  padding: 14px 16px;
}

.proxy-item:first-of-type {
  border-color: rgba(16, 185, 129, 0.45);
}

.proxy-item-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
}

.proxy-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
  color: #94a3b8;
  font-size: 0.78rem;
}

.proxy-meta-chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #64748b;
  font-weight: 700;
}

.proxy-meta-divider {
  width: 1px;
  height: 14px;
  background: #dbe4ef;
}

.proxy-meta-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: #cbd5e1;
}

.proxy-item-identity {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proxy-item-main strong {
  overflow: hidden;
  color: var(--title);
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.88rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proxy-item-main span {
  color: inherit;
}

.proxy-item-main span.is-success {
  color: #15803d;
}

.proxy-item-main span.is-error {
  color: #b91c1c;
}

@media (max-width: 760px) {
  .long-link-grid,
  .result-link-row,
  .proxy-status-panel,
  .proxy-item {
    grid-template-columns: 1fr;
  }

  .proxy-status-panel,
  .long-link-section-head,
  .long-link-submit-section {
    align-items: stretch;
    flex-direction: column;
  }

  .long-link-token-section,
  .long-link-options-section,
  .long-link-submit-section {
    padding: 18px;
  }

  .long-link-actions {
    justify-content: stretch;
  }

  .long-link-actions :deep(.n-button) {
    flex: 1 1 auto;
  }
}
</style>
