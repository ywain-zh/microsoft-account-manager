<template>
  <div class="page-stack page-container seven79-page">
    <section class="page-header seven79-page-header">
      <div class="page-title-wrap">
        <h1 class="main-title">验卡工作台</h1>
      </div>
      <p class="page-desc">实时处理卡片数据提取与短信验证码同步</p>
    </section>

    <section class="action-bar">
      <div class="action-bar-main">
        <div class="action-group action-group-left">
          <n-input
            v-model:value="quickCheckKey"
            class="action-input"
            placeholder="输入卡密提取信息..."
            @keyup.enter="handleQuickCheck"
          />
          <n-button type="primary" class="action-button-primary" :loading="quickCheckLoading" @click="handleQuickCheck">
            提取并验证
          </n-button>
          <n-button class="action-button-secondary" :disabled="!canCopySelectedCardBundle" @click="handleCopySelectedCardBundle">
            复制整卡
          </n-button>
          <n-button class="action-button-secondary" @click="handleFetchSession">
            获取session
          </n-button>
          <a
            class="subscription-link-button"
            href="https://payurl.779.chat/"
            target="_blank"
            rel="noopener noreferrer"
          >
            订阅链接
          </a>
        </div>
        <div class="action-group action-group-right">
          <n-button class="action-button-secondary" @click="openListModal('cards')">卡密历史</n-button>
          <n-button class="action-button-ghost" @click="openListModal('pp')">PP接码池</n-button>
        </div>
      </div>

      <div v-if="quickCheckResult" class="quick-check-strip">
        <div v-for="field in quickCheckFields" :key="field.label" class="quick-check-item">
          <span>{{ field.label }}</span>
          <strong>{{ field.value }}</strong>
        </div>
      </div>
    </section>

    <section class="dashboard-grid">
      <article class="work-card payment-work-card">
        <header class="work-card-header">
          <div class="work-card-title-row">
            <h2>虚拟卡</h2>
            <span class="work-card-inline-meta">剩余时间 {{ selectedCardRemainingText }}</span>
          </div>
          <div class="status-badge" :class="statusBadgeClass">
            <span class="status-dot" aria-hidden="true"></span>
            {{ selectedCardStatusText }}
          </div>
        </header>

        <div v-if="selectedItem" class="work-card-body payment-card-body">
          <section class="info-panel">
            <div class="virtual-detail-stack">
              <div class="virtual-detail-row virtual-detail-row-full">
                <div class="virtual-detail-line-header">
                  <div class="virtual-detail-line-inline virtual-detail-line-inline-number">
                    <span class="virtual-detail-line-label">卡号:</span>
                    <strong class="virtual-detail-line-value mono-text">{{ formatCardNumberDisplay(selectedItem.cardNumber) }}</strong>
                  </div>
                  <button
                    type="button"
                    class="virtual-line-copy-button"
                    :disabled="!isCopyableValue(selectedItem.cardNumber)"
                    @click="copyValue(selectedItem.cardNumber, '卡号')"
                  >
                    复制
                  </button>
                </div>
              </div>

              <div class="virtual-detail-meta-row">
                <div class="virtual-detail-row">
                  <div class="virtual-detail-line-header">
                    <div class="virtual-detail-line-inline">
                      <span class="virtual-detail-line-label">日期:</span>
                      <strong class="virtual-detail-line-value mono-text">{{ formatCardExpiryDisplay(selectedItem.expiryDate) }}</strong>
                    </div>
                    <button
                      type="button"
                      class="virtual-line-copy-button"
                      :disabled="!isCopyableValue(formatCardExpiryDisplay(selectedItem.expiryDate))"
                      @click="copyValue(formatCardExpiryDisplay(selectedItem.expiryDate), '日期')"
                    >
                      复制
                    </button>
                  </div>
                </div>

                <div class="virtual-detail-row">
                  <div class="virtual-detail-line-header">
                    <div class="virtual-detail-line-inline">
                      <span class="virtual-detail-line-label">CVV / 安全码:</span>
                      <strong class="virtual-detail-line-value mono-text">{{ displayValue(selectedItem.cvv) }}</strong>
                    </div>
                    <button
                      type="button"
                      class="virtual-line-copy-button"
                      :disabled="!isCopyableValue(selectedItem.cvv)"
                      @click="copyValue(selectedItem.cvv, 'CVV')"
                    >
                      复制
                    </button>
                  </div>
                </div>
              </div>

              <div class="virtual-detail-row virtual-detail-row-full" v-if="isCopyableValue(selectedItem.holderName) || displayValue(selectedItem.holderName) !== '-'">
                <div class="virtual-detail-line-header">
                  <div class="virtual-detail-line-inline">
                    <span class="virtual-detail-line-label">持卡人:</span>
                    <strong class="virtual-detail-line-value">{{ displayValue(selectedItem.holderName) }}</strong>
                  </div>
                  <button
                    type="button"
                    class="virtual-line-copy-button"
                    :disabled="!isCopyableValue(selectedItem.holderName)"
                    @click="copyValue(selectedItem.holderName, '姓名')"
                  >
                    复制
                  </button>
                </div>
              </div>

              <div class="virtual-detail-address-stack">
                <div class="virtual-detail-row virtual-detail-row-full">
                  <div class="virtual-detail-line-header">
                    <div class="virtual-detail-line-inline">
                      <span class="virtual-detail-line-label">地址信息:</span>
                      <strong class="virtual-detail-line-value">{{ displayValue(selectedParsedAddress.fullAddress) }}</strong>
                    </div>
                    <button
                      type="button"
                      class="virtual-line-copy-button"
                      :disabled="!isCopyableValue(selectedParsedAddress.fullAddress)"
                      @click="copyValue(selectedParsedAddress.fullAddress, '地址')"
                    >
                      复制
                    </button>
                  </div>
                </div>

                <div v-for="field in selectedAddressFields" :key="field.label" class="virtual-detail-row virtual-detail-row-full">
                  <div class="virtual-detail-line-header">
                    <div class="virtual-detail-line-inline">
                      <span class="virtual-detail-line-label">{{ field.label }}:</span>
                      <strong class="virtual-detail-line-value" :class="{ 'mono-text': field.mono }">{{ displayValue(field.value) }}</strong>
                    </div>
                    <button
                      type="button"
                      class="virtual-line-copy-button"
                      :disabled="!isCopyableValue(field.value)"
                      @click="copyValue(field.value, field.copyLabel)"
                    >
                      复制
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
        <div v-else class="work-card-body empty-card-body">
          <n-empty description="点击右侧按钮打开列表管理，选择卡密后这里会展示详情。" class="section-empty" />
        </div>

        <footer class="work-card-footer">
          <span>卡片有效期:</span>
          <strong>{{ displayValue(selectedItem?.cardValidUntil) }}</strong>
        </footer>
      </article>

      <article class="work-card sms-work-card">
        <header class="work-card-header">
          <div>
            <h2>接码短信</h2>
          </div>
          <div class="status-badge status-badge-success status-badge-subtle">
            <span class="status-dot status-dot-pulse" aria-hidden="true"></span>
            连接正常
          </div>
        </header>

        <div class="work-card-body sms-card-body">
          <div class="sms-stack">
            <section class="sms-block">
              <div class="sms-block-header">
                <div>
                  <div class="meta-label">专用接码线路</div>
                </div>
              </div>

              <div class="phone-row">
                <div class="phone-text mono-text">{{ displayValue(selectedItem?.phone) }}</div>
                <button
                  type="button"
                  class="copy-icon-button"
                  :disabled="!isCopyableValue(selectedItem?.phone)"
                  @click="copyValue(selectedItem?.phone, '虚拟卡手机号')"
                >
                  <CopyIcon />
                </button>
              </div>

              <div class="code-panel">
                <div class="code-line code-line-centered">
                  <button
                    type="button"
                    class="code-display code-display-button"
                    :class="{ 'code-display-pending': isPendingCode(cardCodeInput), 'code-display-clickable': isCopyableValue(cardCodeInput) }"
                    :disabled="!isCopyableValue(cardCodeInput)"
                    @click="copyValue(cardCodeInput, '虚拟卡验证码')"
                  >
                    {{ cardCodeInput }}
                  </button>
                </div>
              </div>

              <div class="sms-actions sms-actions-centered">
                <n-button
                  text
                  class="refresh-button refresh-button-inline"
                  :disabled="!selectedItem?.smsApi"
                  :loading="cardCodeLoading"
                  @click="handleFetchSelectedCardCode"
                >
                  强制刷新
                </n-button>
              </div>
            </section>

            <section class="sms-block">
              <div class="sms-block-header">
                <div>
                  <div class="meta-label">PayPal 绑定线路</div>
                </div>
              </div>

              <div class="pp-phone-select-row">
                <div class="pp-select-wrap pp-select-wrap-single">
                  <n-select
                    v-model:value="selectedPpSmsId"
                    :options="ppSmsOptions"
                    placeholder="请选择 PP 接码手机号"
                    clearable
                  />
                </div>
                <button
                  type="button"
                  class="copy-icon-button"
                  :disabled="!isCopyableValue(selectedPpSmsPhone.number)"
                  @click="copyValue(selectedPpSmsPhone.number, 'PP手机号')"
                >
                  <CopyIcon />
                </button>
              </div>

              <div class="code-panel">
                <div class="code-line code-line-centered">
                  <button
                    type="button"
                    class="code-display code-display-button"
                    :class="{ 'code-display-pending': isPendingCode(ppCodeInput), 'code-display-clickable': isCopyableValue(ppCodeInput) }"
                    :disabled="!isCopyableValue(ppCodeInput)"
                    @click="copyValue(ppCodeInput, 'PP验证码')"
                  >
                    {{ ppCodeInput }}
                  </button>
                </div>
              </div>

              <div class="sms-actions sms-actions-centered">
                <n-button
                  text
                  class="refresh-button refresh-button-inline"
                  :disabled="!selectedPpSmsId"
                  :loading="ppCodeLoading"
                  @click="handleFetchSelectedPpCode"
                >
                  请求验证码
                </n-button>
              </div>

              <div class="sms-block-expiry">
                <span>有效期</span>
                <strong>{{ selectedPpSmsItem?.expiresAt || '-' }}</strong>
              </div>
            </section>
          </div>
        </div>

        <footer class="work-card-footer work-card-footer-right">
          <strong>网关数据每 30 秒自动同步</strong>
        </footer>
      </article>
    </section>

    <n-modal v-model:show="listModalVisible" preset="card" title="列表管理" style="width: min(1280px, 96vw);">
      <div class="list-modal">
        <div class="list-toolbar">
          <div class="list-switch">
            <button
              type="button"
              class="switch-button"
              :class="{ 'switch-button-active': activeListTab === 'cards' }"
              @click="activeListTab = 'cards'"
            >
              卡密列表
            </button>
            <button
              type="button"
              class="switch-button"
              :class="{ 'switch-button-active': activeListTab === 'pp' }"
              @click="activeListTab = 'pp'"
            >
              PP接码列表
            </button>
          </div>
          <div class="toolbar-actions">
            <n-button size="small" @click="handleRefreshAll" :loading="tableLoading || ppTableLoading">刷新</n-button>
            <n-button v-if="activeListTab === 'pp'" size="small" @click="ppImportVisible = true">PP接码导入</n-button>
            <n-button v-if="activeListTab === 'cards'" size="small" @click="importVisible = true">批量导入</n-button>
            <n-button
              v-if="activeListTab === 'cards'"
              size="small"
              type="primary"
              :loading="extractAllLoading"
              :disabled="items.length === 0"
              @click="handleExtractAll"
            >
              一键提取
            </n-button>
          </div>
        </div>

        <div v-if="activeListTab === 'cards'" class="list-panel-single">
          <n-input
            v-model:value="searchKeyword"
            clearable
            class="seven79-search"
            placeholder="按卡密 / 卡号 / 手机号搜索"
            @keyup.enter="loadItems"
          />
          <section class="modal-panel">
            <div class="section-head">
              <div>
                <h2>卡密列表</h2>
                <span>点行即可切换主页面展示的卡片信息</span>
              </div>
            </div>
            <div v-if="items.length > 0" class="table-shell">
              <n-data-table
                class="seven79-table"
                size="small"
                :bordered="false"
                :columns="columns"
                :data="items"
                :row-key="rowKey"
                :row-props="rowProps"
                :loading="tableLoading"
                :checked-row-keys="checkedRowKeys"
                :pagination="false"
                max-height="420"
                @update:checked-row-keys="handleCheckedRowKeysUpdate"
              />
            </div>
            <n-empty v-else description="还没有导入任何 779 卡密" class="table-empty" />
          </section>
        </div>

        <div v-else class="list-panel-single">
          <section class="modal-panel">
            <div class="section-head">
              <div>
                <h2>PP接码列表</h2>
                <span>点行即可切换主页面下方的 PP 接码手机号</span>
              </div>
            </div>
            <div v-if="ppSmsItems.length > 0" class="table-shell">
              <n-data-table
                class="seven79-table"
                size="small"
                :bordered="false"
                :columns="ppColumns"
                :data="ppSmsItems"
                :row-key="ppRowKey"
                :row-props="ppRowProps"
                :loading="ppTableLoading"
                :pagination="false"
                max-height="420"
              />
            </div>
            <n-empty v-else description="还没有导入任何 PP 接码手机号" class="table-empty" />
          </section>
        </div>
      </div>
    </n-modal>

    <n-modal v-model:show="importVisible" preset="card" title="批量导入 779 卡密" style="width: min(720px, 92vw);">
      <n-form label-placement="top">
        <n-form-item label="卡密列表">
          <n-input
            v-model:value="importText"
            type="textarea"
            placeholder="每行一个卡密"
            :autosize="{ minRows: 10, maxRows: 16 }"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="importVisible = false">取消</n-button>
          <n-button type="primary" :loading="importLoading" @click="handleImport">导入</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="ppImportVisible" preset="card" title="导入 PP 接码" style="width: min(760px, 92vw);">
      <n-form label-placement="top">
        <n-form-item label="PP 接码列表">
          <n-input
            v-model:value="ppImportText"
            type="textarea"
            placeholder="+13502473488------------http://a.62-us.com/api/get_sms?key=xxxx"
            :autosize="{ minRows: 10, maxRows: 16 }"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="ppImportVisible = false">取消</n-button>
          <n-button type="primary" :loading="ppImportLoading" @click="handleImportPp">导入</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import {
  createDiscreteApi,
  NButton,
  NDataTable,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NTag,
  type DataTableColumns
} from 'naive-ui';
import { api } from '../api';
import type {
  PpSmsItem,
  PpSmsStatus,
  Seven79CardItem,
  Seven79CardStatus,
  Seven79CheckResponse
} from '../types';

type InfoField = {
  label: string;
  value: string;
  wide?: boolean;
  tone?: 'error';
};

type ParsedAddress = {
  fullAddress: string;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

type AddressField = {
  label: string;
  value: string | null;
  copyLabel: string;
  mono?: boolean;
};

type SplitPhone = {
  prefix: string | null;
  number: string | null;
};

const CopyGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
    [
      h('path', {
        d: 'M7 7.75A1.75 1.75 0 0 1 8.75 6h6.5A1.75 1.75 0 0 1 17 7.75v6.5A1.75 1.75 0 0 1 15.25 16h-6.5A1.75 1.75 0 0 1 7 14.25z',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linejoin': 'round'
      }),
      h('path', {
        d: 'M4.75 13.25A1.75 1.75 0 0 1 3 11.5V5.25A1.75 1.75 0 0 1 4.75 3.5H11A1.75 1.75 0 0 1 12.75 5.25',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      })
    ]
  );

const CopyIcon = {
  name: 'CopyIcon',
  render: CopyGlyph
};

const { message } = createDiscreteApi(['message']);

const tableLoading = ref(false);
const ppTableLoading = ref(false);
const importLoading = ref(false);
const ppImportLoading = ref(false);
const quickCheckLoading = ref(false);
const extractAllLoading = ref(false);
const rowActionLoadingId = ref<number | null>(null);
const ppRowActionLoadingId = ref<number | null>(null);
const cardCodeLoading = ref(false);
const ppCodeLoading = ref(false);

const activeListTab = ref<'cards' | 'pp'>('cards');
const listModalVisible = ref(false);
const importVisible = ref(false);
const ppImportVisible = ref(false);
const importText = ref('');
const ppImportText = ref('');
const searchKeyword = ref('');
const quickCheckKey = ref('');
const quickCheckResult = ref<Seven79CheckResponse | null>(null);

const items = ref<Seven79CardItem[]>([]);
const ppSmsItems = ref<PpSmsItem[]>([]);
const selectedRowId = ref<number | null>(null);
const selectedPpSmsId = ref<number | null>(null);
const checkedRowKeys = ref<number[]>([]);
const cardCodeInput = ref('暂无验证码');
const ppCodeInput = ref('暂无验证码');

const selectedItem = computed(() => {
  return items.value.find((item) => item.id === selectedRowId.value) ?? null;
});

const selectedPpSmsItem = computed(() => {
  return ppSmsItems.value.find((item) => item.id === selectedPpSmsId.value) ?? null;
});

const ppSmsOptions = computed(() =>
  ppSmsItems.value.map((item) => ({
    label: formatPpPhoneOptionLabel(item),
    value: item.id
  }))
);

const selectedPpSmsPhone = computed(() => splitPhoneValue(selectedPpSmsItem.value?.fullPhone));

const selectedParsedAddress = computed<ParsedAddress>(() => parseSelectedCardAddress(selectedItem.value?.address));

const selectedAddressFields = computed<AddressField[]>(() => {
  const address = selectedParsedAddress.value;
  return [
    { label: '街道', value: address.street, copyLabel: '街道地址' },
    { label: '城市', value: address.city, copyLabel: '城市' },
    { label: '州', value: address.state, copyLabel: '州' },
    { label: '邮编', value: address.postalCode, copyLabel: '邮编', mono: true },
    { label: '国家', value: address.country, copyLabel: '国家' }
  ];
});

const quickCheckFields = computed<InfoField[]>(() => {
  const result = quickCheckResult.value;
  if (!result) {
    return [];
  }

  return [
    { label: '分类', value: displayValue(result.check.category) },
    { label: '卡密有效期', value: displayValue(result.check.expiryTime) },
    { label: '剩余', value: formatRemaining(result.check.remainingTimeMs) },
    { label: '卡号', value: displayValue(result.verify.cardNumber) },
    { label: '日期/CVV', value: formatExpiryCvv(result.verify.expiryDate, result.verify.cvv) },
    { label: '手机号', value: displayValue(result.verify.phone) },
    { label: '姓名', value: displayValue(result.verify.holderName) }
  ];
});

const selectedCardStatusText = computed(() => {
  const item = selectedItem.value;
  if (!item) {
    return '待选择';
  }

  const status = renderStatusLabel(item.status);
  const remaining = formatRemaining(getCardValidityRemainingMs(item.cardValidUntil));
  return remaining !== '-' ? `${status} (${remaining})` : status;
});

const selectedCardRemainingText = computed(() => {
  const item = selectedItem.value;
  if (!item) {
    return '-';
  }

  return formatRemaining(getCardValidityRemainingMs(item.cardValidUntil));
});

const statusBadgeClass = computed(() => {
  const item = selectedItem.value;
  if (!item) {
    return 'status-badge-neutral';
  }
  if (item.status === 'checked') {
    return 'status-badge-success';
  }
  if (item.status === 'failed') {
    return 'status-badge-error';
  }
  if (item.status === 'expired') {
    return 'status-badge-warning';
  }
  return 'status-badge-neutral';
});

const selectedCardBundle = computed(() => {
  const item = selectedItem.value;
  if (!item) {
    return '';
  }

  const lines = [
    `卡密: ${displayValue(item.cardKey)}`,
    `卡号: ${displayValue(item.cardNumber)}`,
      `日期: ${formatCardExpiryDisplay(item.expiryDate)}`,
    `CVV: ${displayValue(item.cvv)}`,
    `姓名: ${displayValue(item.holderName)}`,
    `地址: ${displayValue(item.address)}`,
    `手机号: ${displayValue(item.phone)}`,
    `卡片有效期: ${displayValue(item.cardValidUntil)}`,
    `远端到期: ${displayValue(item.expiresAt)}`
  ];

  return lines.join('\n');
});

const canCopySelectedCardBundle = computed(() => Boolean(selectedItem.value));

watch(
  selectedItem,
  (item) => {
    cardCodeInput.value = item?.smsApi ? '暂无验证码' : '无接码接口';
  },
  { immediate: true }
);

watch(
  selectedPpSmsItem,
  (item) => {
    if (!item) {
      ppCodeInput.value = '暂无验证码';
      return;
    }
    ppCodeInput.value = resolveCodeDisplay(item.lastCode, item.lastMessage, item.status);
  },
  { immediate: true }
);

const rowKey = (row: Seven79CardItem): number => row.id;
const ppRowKey = (row: PpSmsItem): number => row.id;

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }

  const text = String(value).trim();
  return text.length > 0 ? text : '-';
}

function normalizeCopyValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function isCopyableValue(value: string | number | null | undefined): boolean {
  const text = normalizeCopyValue(value);
  if (!text) {
    return false;
  }
  return !['-', '暂无验证码', '无接码接口', '已过期', '获取失败'].includes(text);
}

function isPendingCode(value: string): boolean {
  return !/^\d+(\s+\d+)*$/.test(value.trim());
}

function extractNumericCode(value: string | number | null | undefined): string | null {
  const text = normalizeCopyValue(value);
  if (!text) {
    return null;
  }

  const sanitized = normalizeCodeCandidateText(text);
  const matches = [...sanitized.matchAll(/(?<!\d)(\d{4,8})(?!\d)/g)]
    .map((match) => {
      const code = match[1];
      const index = match.index ?? -1;
      const context = sanitized.slice(Math.max(0, index - 80), Math.min(sanitized.length, index + code.length + 80));
      return {
        code,
        index,
        score: /^20\d{2}$/.test(code) ? Number.NEGATIVE_INFINITY : scoreCodeCandidate(code, context)
      };
    })
    .filter((match) => Number.isFinite(match.score));
  if (matches.length === 0) {
    return null;
  }

  const preferred = matches
    .filter((match) => match.score > 0)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .at(-1);
  if (preferred) {
    return preferred.code;
  }

  return matches.at(-1)?.code ?? null;
}

function normalizeCodeCandidateText(value: string): string {
  return decodeBasicHtmlEntities(value)
    .replace(/到期时间[:：]\s*[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/g, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function scoreCodeCandidate(code: string, context: string): number {
  let score = 0;

  if (/your\s+chatgpt\s+code\s+is/i.test(context)) {
    score += 10;
  }
  if (/(temporary\s+verification\s+code|verification\s+code|one-time\s+passcode|passcode|security\s+code|验证码|校验码|动态码|动态验证码|短信码|短信验证码|\botp\b|\bcode\b)/i.test(context)) {
    score += 6;
  }
  if (/(openai|chatgpt|paypal)/i.test(context)) {
    score += 3;
  }
  if (/(到期时间|expires?\s+at|有效期|过期)/i.test(context)) {
    score -= 4;
  }
  if (/^\d{6}$/.test(code)) {
    score += 2;
  } else if (/^\d{4}$/.test(code)) {
    score += 1;
  }

  return score;
}


function resolveCodeDisplay(
  code: string | null | undefined,
  messageText: string | null | undefined,
  status?: PpSmsStatus | Seven79CardStatus
): string {
  const matchedCode = extractNumericCode(code) || extractNumericCode(messageText);
  if (matchedCode) {
    return matchedCode;
  }

  const normalizedMessage = normalizeCopyValue(messageText);
  if (status === 'expired' || normalizedMessage.includes('已过期')) {
    return '已过期';
  }
  if (status === 'failed' || normalizedMessage.includes('失败')) {
    return '获取失败';
  }

  return '暂无验证码';
}

async function copyValue(value: string | number | null | undefined, label: string): Promise<void> {
  const text = normalizeCopyValue(value);
  if (!isCopyableValue(text)) {
    message.warning(`没有可复制的${label}`);
    return;
  }

  try {
    await writeClipboard(text);
    message.success(`${label}已复制`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制失败');
  }
}


async function handleCopySelectedCardBundle(): Promise<void> {
  await copyValue(selectedCardBundle.value, '整卡信息');
}

function handleFetchSession(): void {
  window.open('https://chatgpt.com/api/auth/session', '_blank', 'noopener,noreferrer');
}
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function renderStatusLabel(status: Seven79CardStatus): string {
  if (status === 'checked') {
    return '已提取';
  }
  if (status === 'expired') {
    return '过期';
  }
  if (status === 'failed') {
    return '失败';
  }
  return '待提取';
}

function renderStatusType(status: Seven79CardStatus): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'checked') {
    return 'success';
  }
  if (status === 'expired') {
    return 'warning';
  }
  if (status === 'failed') {
    return 'error';
  }
  return 'default';
}

function renderPpStatusLabel(status: PpSmsStatus): string {
  if (status === 'expired') {
    return '过期';
  }
  if (status === 'failed') {
    return '失败';
  }
  return '可用';
}

function splitPhoneValue(value: string | null | undefined): SplitPhone {
  const normalized = normalizeCopyValue(value);
  if (!normalized) {
    return { prefix: null, number: null };
  }

  const digits = normalized.replace(/\D/g, '');
  if (!digits) {
    return { prefix: null, number: null };
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return {
      prefix: '+1',
      number: digits.slice(1)
    };
  }

  if (normalized.trim().startsWith('+') && digits.length > 10) {
    return {
      prefix: `+${digits.slice(0, digits.length - 10)}`,
      number: digits.slice(-10)
    };
  }

  return {
    prefix: null,
    number: digits
  };
}

function formatPpPhoneOptionLabel(item: PpSmsItem): string {
  const { prefix, number } = splitPhoneValue(item.fullPhone);
  const phoneLabel = [prefix ? `(${prefix})` : null, number].filter(Boolean).join(' ');
  return `${phoneLabel || '-'} · ${renderPpStatusLabel(item.status)}`;
}

function renderPpStatusType(status: PpSmsStatus): 'success' | 'error' | 'warning' {
  if (status === 'expired') {
    return 'warning';
  }
  if (status === 'failed') {
    return 'error';
  }
  return 'success';
}

function parseDateTimeValue(value: string | null): Date | null {
  const text = normalizeCopyValue(value);
  if (!text) {
    return null;
  }

  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) {
    return new Date(direct);
  }

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCardValidityRemainingMs(value: string | null): number | null {
  const parsed = parseDateTimeValue(value);
  if (!parsed) {
    return null;
  }

  return Math.max(0, parsed.getTime() - Date.now());
}

function isCardStillValid(value: string | null): boolean {
  const remaining = getCardValidityRemainingMs(value);
  return remaining !== null && remaining > 0;
}

function renderCardValidityText(value: string | null): string {
  if (!value) {
    return '-';
  }

  const remaining = getCardValidityRemainingMs(value);
  if (remaining === null) {
    return value;
  }
  if (remaining <= 0) {
    return '已过期';
  }

  return `有效 ${formatRemaining(remaining)}`;
}

function renderCardValidityType(value: string | null): 'success' | 'error' | 'default' {
  if (!value) {
    return 'default';
  }

  return isCardStillValid(value) ? 'success' : 'error';
}

function formatRemaining(value: number | null): string {
  if (value === null || value <= 0) {
    return '-';
  }

  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分 ${seconds}秒`;
}

function parseSelectedCardAddress(value: string | null | undefined): ParsedAddress {
  const fullAddress = normalizeCopyValue(value);
  if (!fullAddress) {
    return createParsedAddress('-');
  }

  const normalized = fullAddress.replace(/\s+/g, ' ').trim();
  const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean);

  const parsedCommaAddress = parseCommaSeparatedAddress(normalized, parts);
  if (parsedCommaAddress) {
    return parsedCommaAddress;
  }

  const parsedTailAddress = parseAddressByTailPattern(normalized);
  if (parsedTailAddress) {
    return parsedTailAddress;
  }

  return createParsedAddress(normalized);
}

function parseCommaSeparatedAddress(fullAddress: string, parts: string[]): ParsedAddress | null {
  if (parts.length < 2) {
    return null;
  }

  const countryPart = resolveAddressCountry(parts.at(-1) ?? null);
  const cityStatePostalPart = parts.at(-2) ?? '';
  const streetParts = parts.slice(0, Math.max(0, parts.length - 2));
  const street = streetParts.join(', ').trim() || null;
  const location = parseCityStatePostal(cityStatePostalPart) ?? parseCityPostal(cityStatePostalPart);
  if (!location) {
    return null;
  }

  return {
    fullAddress,
    street,
    city: location.city,
    state: location.state,
    postalCode: location.postalCode,
    country: countryPart || null
  };
}

function parseAddressByTailPattern(fullAddress: string): ParsedAddress | null {
  const tailMatch = fullAddress.match(/^(.*?)(?:,?\s+)([A-Za-z .'-]+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)(?:,?\s+([A-Za-z]{2,}|United States|USA))?$/i);
  if (!tailMatch) {
    return null;
  }

  const [, street, city, state, postalCode, country] = tailMatch;
  return {
    fullAddress,
    street: street.trim() || null,
    city: city.trim() || null,
    state: state.toUpperCase(),
    postalCode,
    country: resolveAddressCountry(country)
  };
}

function parseCityStatePostal(value: string): { city: string | null; state: string | null; postalCode: string | null } | null {
  const normalized = normalizeCopyValue(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/\s+/g, ' ').trim();
  const match = compact.match(/^(.*?)(?:\s+|,\s*)([A-Z]{2})(?:\s+|,\s*)(\d{5}(?:-\d{4})?)$/i);
  if (!match) {
    return null;
  }

  const [, city, state, postalCode] = match;
  return {
    city: city.replace(/,$/, '').trim() || null,
    state: state.toUpperCase(),
    postalCode
  };
}

function parseCityPostal(value: string): { city: string | null; state: string | null; postalCode: string | null } | null {
  const normalized = normalizeCopyValue(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/\s+/g, ' ').trim();
  const match = compact.match(/^(.*?)(?:\s+|,\s*)(\d{5}(?:-\d{4})?)$/);
  if (!match) {
    return null;
  }

  const [, city, postalCode] = match;
  const parsedCity = city.replace(/,$/, '').trim() || null;
  if (!parsedCity) {
    return null;
  }

  return {
    city: parsedCity,
    state: null,
    postalCode
  };
}

function resolveAddressCountry(value: string | null | undefined): string | null {
  const normalized = normalizeCopyValue(value);
  if (!normalized) {
    return null;
  }

  const upper = normalized.toUpperCase();
  if (upper === 'USA' || upper === 'UNITED STATES' || upper === 'UNITED STATES OF AMERICA') {
    return 'US';
  }

  return normalized;
}

function createParsedAddress(fullAddress: string): ParsedAddress {
  return {
    fullAddress,
    street: null,
    city: null,
    state: null,
    postalCode: null,
    country: null
  };
}

function formatExpiryCvv(expiryDate: string | null, cvv: string | null): string {
  return `${formatCardExpiryDisplay(expiryDate)} / ${cvv || '-'}`;
}

function formatCardNumberDisplay(value: string | null | undefined): string {
  const normalized = normalizeCopyValue(value).replace(/\s+/g, '');
  if (!normalized) {
    return '-';
  }

  const digitsOnly = normalized.replace(/\D/g, '');
  if (digitsOnly.length >= 12) {
    return digitsOnly.match(/.{1,4}/g)?.join(' ') ?? digitsOnly;
  }

  return normalized;
}

function formatCardExpiryDisplay(expiryDate: string | null | undefined): string {
  if (!expiryDate) {
    return '-';
  }

  const text = String(expiryDate).trim();
  if (!text) {
    return '-';
  }

  const slashMatch = text.match(/^(\d{2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, month, year] = slashMatch;
    return `${month}/${year.slice(-2)}`;
  }

  const reverseSlashMatch = text.match(/^(\d{4})\/(\d{1,2})$/);
  if (reverseSlashMatch) {
    const [, year, month] = reverseSlashMatch;
    return `${month.padStart(2, '0')}/${year.slice(-2)}`;
  }

  const dashMatch = text.match(/^(\d{4})-(\d{1,2})$/);
  if (dashMatch) {
    const [, year, month] = dashMatch;
    return `${month.padStart(2, '0')}/${year.slice(-2)}`;
  }

  return text;
}

async function loadItems(): Promise<void> {
  tableLoading.value = true;
  try {
    const result = await api.listSeven79Cards(searchKeyword.value.trim());
    items.value = result.items;
    if (!selectedRowId.value && result.items.length > 0) {
      selectedRowId.value = result.items[0].id;
    } else if (selectedRowId.value && !result.items.some((item) => item.id === selectedRowId.value)) {
      selectedRowId.value = result.items[0]?.id ?? null;
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载失败');
  } finally {
    tableLoading.value = false;
  }
}

async function loadPpSmsItems(): Promise<void> {
  ppTableLoading.value = true;
  try {
    const result = await api.listPpSmsItems();
    ppSmsItems.value = result.items;
    if (!selectedPpSmsId.value && result.items.length > 0) {
      selectedPpSmsId.value = result.items[0].id;
    } else if (selectedPpSmsId.value && !result.items.some((item) => item.id === selectedPpSmsId.value)) {
      selectedPpSmsId.value = result.items[0]?.id ?? null;
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'PP 接码列表加载失败');
  } finally {
    ppTableLoading.value = false;
  }
}

async function handleRefreshAll(): Promise<void> {
  await Promise.all([loadItems(), loadPpSmsItems()]);
}

function openListModal(tab: 'cards' | 'pp'): void {
  activeListTab.value = tab;
  listModalVisible.value = true;
}

async function handleImport(): Promise<void> {
  const text = importText.value.trim();
  if (!text) {
    message.warning('请输入要导入的卡密');
    return;
  }

  importLoading.value = true;
  try {
    const result = await api.importSeven79Cards(text);
    message.success(`导入完成：新增 ${result.inserted}，跳过 ${result.skipped}`);
    if (result.errors.length > 0) {
      message.warning(`有 ${result.errors.length} 行导入失败`);
    }
    importText.value = '';
    importVisible.value = false;
    await loadItems();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导入失败');
  } finally {
    importLoading.value = false;
  }
}

async function handleImportPp(): Promise<void> {
  const text = ppImportText.value.trim();
  if (!text) {
    message.warning('请输入要导入的 PP 接码内容');
    return;
  }

  ppImportLoading.value = true;
  try {
    const result = await api.importPpSmsItems(text);
    ppSmsItems.value = mergePpSmsItems(ppSmsItems.value, result.items);
    if (!selectedPpSmsId.value && result.items.length > 0) {
      selectedPpSmsId.value = result.items[0].id;
    }
    message.success(`PP 导入完成：新增 ${result.inserted}，跳过 ${result.skipped}`);
    if (result.errors.length > 0) {
      message.warning(`有 ${result.errors.length} 行导入失败`);
    }
    ppImportText.value = '';
    ppImportVisible.value = false;
    await loadPpSmsItems();
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'PP 导入失败');
  } finally {
    ppImportLoading.value = false;
  }
}

async function handleQuickCheck(): Promise<void> {
  const key = quickCheckKey.value.trim();
  if (!key) {
    message.warning('请输入卡密');
    return;
  }

  quickCheckLoading.value = true;
  try {
    const result = await api.checkSeven79Card(key);
    quickCheckResult.value = result;
    patchItem(result.item);
    selectedRowId.value = result.item.id;
    message.success('验卡并提取成功');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '验卡失败');
  } finally {
    quickCheckLoading.value = false;
  }
}

async function handleExtract(row: Seven79CardItem): Promise<void> {
  rowActionLoadingId.value = row.id;
  try {
    const result = await api.extractSeven79Card(row.id);
    patchItem(result.item);
    selectedRowId.value = result.item.id;
    listModalVisible.value = false;
    message.success(`卡密 ${row.cardKey} 提取完成`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '提取失败');
    await loadItems();
  } finally {
    rowActionLoadingId.value = null;
  }
}

async function handleFetchSelectedCardCode(): Promise<void> {
  if (!selectedItem.value) {
    message.warning('请先选择一条卡密记录');
    return;
  }

  if (!selectedItem.value.smsApi) {
    message.warning('当前卡密没有可用的接码接口');
    return;
  }

  cardCodeLoading.value = true;
  try {
    const result = await api.fetchSeven79CardCode(selectedItem.value.id);
    patchItem(result.item);
    const code = extractNumericCode(result.code) || extractNumericCode(result.message);
    cardCodeInput.value = resolveCodeDisplay(result.code, result.message);
    if (code) {
      message.success(`已获取虚拟卡验证码：${code}`);
    } else {
      message.warning(cardCodeInput.value);
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '虚拟卡验证码刷新失败');
    await loadItems();
  } finally {
    cardCodeLoading.value = false;
  }
}

async function handleExtractAll(): Promise<void> {
  extractAllLoading.value = true;
  try {
    const payload = checkedRowKeys.value.length > 0 ? { ids: checkedRowKeys.value } : undefined;
    const result = await api.extractAllSeven79Cards(payload);
    items.value = mergeItems(items.value, result.items);
    if (result.items.length > 0) {
      selectedRowId.value = result.items[0].id;
    }
    message.success(`批量提取完成：成功 ${result.success}，失败 ${result.failure}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '批量提取失败');
    await loadItems();
  } finally {
    extractAllLoading.value = false;
  }
}

async function handleDelete(row: Seven79CardItem): Promise<void> {
  rowActionLoadingId.value = row.id;
  try {
    await api.deleteSeven79Card(row.id);
    items.value = items.value.filter((item) => item.id !== row.id);
    checkedRowKeys.value = checkedRowKeys.value.filter((id) => id !== row.id);
    if (selectedRowId.value === row.id) {
      selectedRowId.value = items.value[0]?.id ?? null;
    }
    message.success('记录已删除');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除失败');
  } finally {
    rowActionLoadingId.value = null;
  }
}

async function handleFetchPpCode(row: PpSmsItem): Promise<void> {
  ppRowActionLoadingId.value = row.id;
  if (selectedPpSmsId.value === row.id) {
    ppCodeLoading.value = true;
  }
  try {
    const result = await api.fetchPpSmsCode(row.id);
    patchPpSmsItem(result.item);
    const code = extractNumericCode(result.code) || extractNumericCode(result.message);
    const codeDisplay = resolveCodeDisplay(result.code, result.message, result.item.status);
    if (selectedPpSmsId.value === row.id) {
      ppCodeInput.value = codeDisplay;
    }
    if (code) {
      message.success(`已获取验证码：${code}`);
    } else {
      message.warning(codeDisplay);
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '刷新验证码失败');
    await loadPpSmsItems();
  } finally {
    ppRowActionLoadingId.value = null;
    if (selectedPpSmsId.value === row.id) {
      ppCodeLoading.value = false;
    }
  }
}

async function handleFetchSelectedPpCode(): Promise<void> {
  if (!selectedPpSmsItem.value) {
    message.warning('请先选择一个 PP 接码手机号');
    return;
  }
  await handleFetchPpCode(selectedPpSmsItem.value);
}

async function handleDeletePp(row: PpSmsItem): Promise<void> {
  ppRowActionLoadingId.value = row.id;
  try {
    await api.deletePpSmsItem(row.id);
    ppSmsItems.value = ppSmsItems.value.filter((item) => item.id !== row.id);
    if (selectedPpSmsId.value === row.id) {
      selectedPpSmsId.value = ppSmsItems.value[0]?.id ?? null;
    }
    message.success('PP 接码记录已删除');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除 PP 接码失败');
  } finally {
    ppRowActionLoadingId.value = null;
  }
}

function handleCheckedRowKeysUpdate(keys: Array<string | number>): void {
  checkedRowKeys.value = keys.map((key) => Number(key)).filter((key) => Number.isInteger(key));
}

function handleRowClick(row: Seven79CardItem): void {
  selectedRowId.value = row.id;
  listModalVisible.value = false;
}

function handlePpRowClick(row: PpSmsItem): void {
  selectedPpSmsId.value = row.id;
}

function rowProps(row: Seven79CardItem): Record<string, unknown> {
  return {
    onClick: () => handleRowClick(row),
    style: 'cursor: pointer;'
  };
}

function ppRowProps(row: PpSmsItem): Record<string, unknown> {
  return {
    onClick: () => handlePpRowClick(row),
    style: 'cursor: pointer;'
  };
}

function patchItem(nextItem: Seven79CardItem): void {
  items.value = mergeItems(items.value, [nextItem]);
}

function patchPpSmsItem(nextItem: PpSmsItem): void {
  ppSmsItems.value = mergePpSmsItems(ppSmsItems.value, [nextItem]);
}

function mergeItems(source: Seven79CardItem[], incoming: Seven79CardItem[]): Seven79CardItem[] {
  const map = new Map(source.map((item) => [item.id, item]));
  for (const item of incoming) {
    map.set(item.id, item);
  }
  return Array.from(map.values()).sort((left, right) => right.id - left.id);
}

function mergePpSmsItems(source: PpSmsItem[], incoming: PpSmsItem[]): PpSmsItem[] {
  const map = new Map(source.map((item) => [item.id, item]));
  for (const item of incoming) {
    map.set(item.id, item);
  }
  return Array.from(map.values()).sort((left, right) => right.id - left.id);
}

const columns: DataTableColumns<Seven79CardItem> = [
  {
    type: 'selection',
    width: 40
  },
  {
    title: '状态',
    key: 'status',
    width: 88,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type: renderStatusType(row.status),
          bordered: false
        },
        { default: () => renderStatusLabel(row.status) }
      )
  },
  {
    title: '卡密',
    key: 'cardKey',
    width: 190,
    ellipsis: { tooltip: true }
  },
  {
    title: '卡号',
    key: 'cardNumber',
    width: 160,
    render: (row) => row.cardNumber || '-'
  },
  {
    title: '日期/CVV',
    key: 'expiryDate',
    width: 116,
    render: (row) => formatExpiryCvv(row.expiryDate, row.cvv)
  },
  {
    title: '卡片有效期',
    key: 'cardValidUntil',
    width: 138,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type: renderCardValidityType(row.cardValidUntil),
          bordered: false
        },
        { default: () => renderCardValidityText(row.cardValidUntil) }
      )
  },
  {
    title: '姓名',
    key: 'holderName',
    width: 150,
    render: (row) => row.holderName || '-'
  },
  {
    title: '操作',
    key: 'actions',
    width: 126,
    render: (row) =>
      h('div', { class: 'action-cell' }, [
        h(
          NButton,
          {
            size: 'tiny',
            type: 'primary',
            ghost: true,
            loading: rowActionLoadingId.value === row.id,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              void handleExtract(row);
            }
          },
          { default: () => '提取' }
        ),
        h(
          NButton,
          {
            size: 'tiny',
            type: 'error',
            text: true,
            disabled: rowActionLoadingId.value === row.id,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              void handleDelete(row);
            }
          },
          { default: () => '删除' }
        )
      ])
  }
];

const ppColumns: DataTableColumns<PpSmsItem> = [
  {
    title: '状态',
    key: 'status',
    width: 88,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type: renderPpStatusType(row.status),
          bordered: false
        },
        { default: () => renderPpStatusLabel(row.status) }
      )
  },
  {
    title: '区号',
    key: 'countryCode',
    width: 72,
    render: (row) => row.countryCode || '-'
  },
  {
    title: 'PP手机号',
    key: 'fullPhone',
    width: 160
  },
  {
    title: '到期',
    key: 'expiresAt',
    width: 168,
    render: (row) => row.expiresAt || '-'
  },
  {
    title: '验证码',
    key: 'lastCode',
    width: 96,
    render: (row) => row.lastCode || '-'
  },
  {
    title: '结果',
    key: 'lastMessage',
    minWidth: 160,
    render: (row) => row.lastMessage || '-'
  },
  {
    title: '操作',
    key: 'actions',
    width: 132,
    render: (row) =>
      h('div', { class: 'action-cell' }, [
        h(
          NButton,
          {
            size: 'tiny',
            type: 'primary',
            ghost: true,
            loading: ppRowActionLoadingId.value === row.id,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              selectedPpSmsId.value = row.id;
              void handleFetchPpCode(row);
            }
          },
          { default: () => '刷新' }
        ),
        h(
          NButton,
          {
            size: 'tiny',
            type: 'error',
            text: true,
            disabled: ppRowActionLoadingId.value === row.id,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              void handleDeletePp(row);
            }
          },
          { default: () => '删除' }
        )
      ])
  }
];

onMounted(async () => {
  await handleRefreshAll();
});
</script>

<style scoped>
.seven79-page {
  --seven79-primary: #4f46e5;
  --seven79-primary-hover: #4338ca;
  --seven79-success: #10b981;
  --seven79-danger: #ef4444;
  --seven79-warning: #f59e0b;
  --seven79-surface: #ffffff;
  --seven79-surface-soft: #f8fafc;
  --seven79-text: #0f172a;
  --seven79-text-soft: #64748b;
  --seven79-text-faint: #94a3b8;
  --seven79-border: #e2e8f0;
  --seven79-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);
  --seven79-radius-lg: 16px;
  --seven79-radius-md: 10px;
  --seven79-mono: 'JetBrains Mono', monospace;
  max-width: 1080px;
  margin: 0 auto;
  gap: 0;
}

.seven79-page-header {
  margin-bottom: 20px;
}

.page-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 6px;
}

.main-title {
  margin: 0;
  color: var(--seven79-text);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.08;
}

.page-desc {
  margin: 0;
  max-width: 520px;
  color: var(--seven79-text-soft);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.55;
}

.action-bar {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
  padding: 12px 14px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: var(--seven79-radius-lg);
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  box-shadow: var(--seven79-shadow);
}

.action-bar-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.action-group-left {
  flex: 1;
  flex-wrap: wrap;
}

.action-group-right {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.action-input {
  width: 296px;
  max-width: 100%;
}

.subscription-link-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 16px;
  border: 1px solid #f59e0b;
  border-radius: 12px;
  background: #fff7ed;
  color: #c2410c;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-decoration: none;
  white-space: nowrap;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.subscription-link-button:hover {
  background: #ffedd5;
  border-color: #ea580c;
  color: #9a3412;
  transform: translateY(-1px);
}

.subscription-link-button:focus-visible {
  outline: 2px solid rgba(245, 158, 11, 0.24);
  outline-offset: 2px;
}

.quick-check-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.quick-check-item {
  padding: 10px 12px;
}

.quick-check-item span {
  display: block;
  margin-bottom: 4px;
  color: var(--seven79-text-faint);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.quick-check-item strong {
  display: block;
  color: var(--seven79-text);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
  word-break: break-word;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}

.work-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 16px;
  background: var(--seven79-surface);
  box-shadow: var(--seven79-shadow);
  overflow: hidden;
}

.work-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.92);
}

.work-card-header h2,
.section-head h2 {
  margin: 0;
  color: var(--seven79-text);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.work-card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.work-card-inline-meta {
  color: #ef4444;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.work-card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 18px;
}

.payment-card-body {
  gap: 14px;
}

.empty-card-body {
  justify-content: center;
}

.sms-card-body {
  padding-top: 14px;
}

.meta-label {
  color: var(--seven79-text-faint);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.mono-text {
  font-family: var(--seven79-mono);
  font-variant-numeric: tabular-nums;
}

.info-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 2px 2px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.virtual-detail-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.virtual-detail-meta-row {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.virtual-detail-address-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.virtual-detail-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 14px;
  border: 1px solid rgba(15, 23, 42, 0.72);
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08);
}

.virtual-detail-row-full {
  width: 100%;
}

.virtual-detail-line-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.virtual-detail-line-inline {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}

.virtual-detail-line-inline-number {
  gap: 8px;
}

.virtual-detail-line-label {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  flex-shrink: 0;
}

.virtual-detail-line-value {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
  text-align: left;
  word-break: break-word;
}

.virtual-line-copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 54px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid rgba(15, 23, 42, 0.72);
  border-radius: 999px;
  background: #ffffff;
  color: #0f172a;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
  flex-shrink: 0;
}

.virtual-line-copy-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.12);
}

.virtual-line-copy-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  box-shadow: none;
}


.status-badge-success {
  background: #ecfdf5;
  color: #059669;
}


.status-badge-warning {
  background: #fffbeb;
  color: #d97706;
}

.status-badge-error {
  background: #fef2f2;
  color: #dc2626;
}

.status-badge-neutral {
  background: #f1f5f9;
  color: #475569;
}

.status-badge-subtle {
  background: transparent;
  color: #64748b;
  padding-right: 0;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 18%, transparent);
  flex-shrink: 0;
}

.status-dot-pulse {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.35);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

.sms-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sms-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.sms-block-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.phone-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0;
}

.phone-text {
  color: var(--seven79-text);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1.25;
  word-break: break-word;
}

.pp-phone-select-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.code-panel {
  display: grid;
  gap: 10px;
  align-content: center;
  justify-items: center;
  min-height: 88px;
  padding: 4px 0 0;
}

.code-line-centered {
  display: flex;
  width: 100%;
  justify-content: center;
}

.code-display {
  color: #4f46e5;
  font-family: var(--seven79-mono);
  font-size: 36px;
  font-weight: 700;
  letter-spacing: 0.16em;
  line-height: 1;
  text-align: center;
  word-break: break-word;
}

.code-display-button {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  appearance: none;
}

.code-display-clickable {
  cursor: pointer;
  transition: transform 0.18s ease, color 0.18s ease, opacity 0.18s ease;
}

.code-display-clickable:hover {
  transform: translateY(-1px) scale(1.02);
  color: #4338ca;
}

.code-display-button:disabled {
  cursor: default;
  opacity: 0.88;
}

.code-display-pending {
  color: #10b981;
  font-size: 18px;
  letter-spacing: 0.08em;
}

.pp-select-wrap {
  position: relative;
  margin-top: 2px;
  flex: 1;
}

.pp-select-wrap-single {
  margin-top: 0;
}

:deep(.pp-select-wrap .n-base-selection) {
  border-radius: 12px;
}

:deep(.pp-select-wrap .n-base-selection-label) {
  min-height: 36px;
}

:deep(.pp-select-wrap .n-base-selection-input) {
  font-family: var(--seven79-mono);
  font-size: 12px;
}

:deep(.pp-select-wrap .n-base-selection-placeholder),
:deep(.pp-select-wrap .n-base-selection-render-label) {
  font-family: var(--seven79-mono);
  font-size: 12px;
}

.sms-block-expiry {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  margin-top: 2px;
  color: var(--seven79-text-faint);
  font-size: 10px;
  font-weight: 600;
}

.sms-block-expiry strong {
  color: var(--seven79-text-soft);
  font-weight: 700;
}

.sms-actions {
  margin-top: auto;
}

.sms-actions-centered {
  display: flex;
  justify-content: center;
}

.work-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 18px;
  border-top: 1px solid var(--seven79-border);
  background: #f8fafc;
  color: var(--seven79-text-soft);
  font-size: 10px;
  font-weight: 600;
}

.work-card-footer strong {
  color: var(--seven79-text);
  font-weight: 700;
}

.work-card-footer-right {
  justify-content: flex-end;
}

.copy-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  opacity: 0.42;
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;
  flex-shrink: 0;
}

.copy-icon-button:hover:not(:disabled) {
  opacity: 0.92;
  transform: scale(1.05);
  background: rgba(15, 23, 42, 0.06);
}

.copy-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.22;
}

.copy-icon-button :deep(svg) {
  width: 13px;
  height: 13px;
}

.list-modal {
  display: grid;
  gap: 12px;
}

.list-toolbar,
.section-head,
.list-switch,
.toolbar-actions,
.action-cell,
.modal-footer {
  display: flex;
  align-items: center;
}

.list-toolbar,
.section-head {
  justify-content: space-between;
}

.list-toolbar {
  gap: 10px;
  flex-wrap: wrap;
}

.section-head {
  gap: 10px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid #edf2f7;
}

.list-switch {
  gap: 6px;
  padding: 4px;
  border-radius: 12px;
  background: #eff4fb;
}

.switch-button {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #475569;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.switch-button-active {
  background: #ffffff;
  color: #2563eb;
  box-shadow: 0 4px 10px rgba(37, 99, 235, 0.12);
}

.toolbar-actions,
.action-cell,
.modal-footer {
  gap: 8px;
  flex-wrap: wrap;
}

.modal-footer {
  justify-content: flex-end;
  gap: 12px;
}

.list-panel-single {
  display: grid;
  gap: 10px;
}

.seven79-search {
  width: 320px;
  max-width: 100%;
}

.modal-panel {
  overflow: hidden;
  border: 1px solid #e8eef6;
  border-radius: 12px;
  background: #f8fafc;
}

.table-shell {
  padding: 0 6px 6px;
}

.table-empty,
.section-empty {
  padding: 22px 0 14px;
}

:deep(.action-input .n-input) {
  border-radius: 12px;
}

:deep(.action-input .n-input-wrapper) {
  padding-left: 2px;
  padding-right: 2px;
}

:deep(.action-input .n-input__input-el) {
  font-family: var(--seven79-mono);
  font-size: 12px;
}

:deep(.action-button-primary),
:deep(.action-button-secondary),
:deep(.action-button-ghost) {
  --n-font-weight: 600 !important;
  letter-spacing: 0.01em;
}

:deep(.action-button-primary) {
  --n-border: none !important;
  --n-border-hover: none !important;
  --n-border-pressed: none !important;
  --n-border-focus: none !important;
  --n-color: var(--seven79-primary) !important;
  --n-color-hover: var(--seven79-primary-hover) !important;
  --n-color-pressed: var(--seven79-primary-hover) !important;
  --n-color-focus: var(--seven79-primary-hover) !important;
  --n-border-radius: 12px !important;
  --n-height: 36px !important;
  --n-padding: 0 16px !important;
  --n-font-size: 12px !important;
  box-shadow: 0 10px 18px rgba(79, 70, 229, 0.18);
}

:deep(.action-button-secondary) {
  --n-border-radius: 12px !important;
  --n-height: 36px !important;
  --n-padding: 0 16px !important;
  --n-font-size: 12px !important;
}

:deep(.action-button-ghost) {
  --n-border-radius: 12px !important;
  --n-height: 36px !important;
  --n-padding: 0 16px !important;
  --n-font-size: 12px !important;
  --n-text-color: #10b981 !important;
  --n-border: 1px solid #a7f3d0 !important;
  --n-color: #f0fdf4 !important;
  --n-color-hover: #ecfdf5 !important;
  --n-color-pressed: #ecfdf5 !important;
  --n-color-focus: #ecfdf5 !important;
}

:deep(.refresh-button-inline) {
  --n-text-color: var(--seven79-primary) !important;
  --n-text-color-hover: var(--seven79-primary-hover) !important;
  --n-text-color-pressed: var(--seven79-primary-hover) !important;
  --n-text-color-focus: var(--seven79-primary-hover) !important;
  --n-font-size: 12px !important;
  --n-height: 24px !important;
  font-weight: 700;
}

:deep(.n-modal .n-card) {
  border-radius: 16px;
}

:deep(.seven79-table .n-data-table-base-table-header) {
  background: #f8fafc !important;
}

:deep(.seven79-table .n-data-table-th),
:deep(.seven79-table .n-data-table-td) {
  padding: 11px 12px !important;
  border-bottom-color: #edf2f7 !important;
}

:deep(.seven79-table .n-data-table-th) {
  color: #334155 !important;
  font-size: 12px;
  font-weight: 700;
  background: #f8fafc !important;
}

:deep(.seven79-table .n-data-table-tr:hover .n-data-table-td) {
  background: #eff6ff !important;
}

@media (max-width: 1200px) {
  .quick-check-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .action-bar-main,
  .action-group,
  .list-toolbar,
  .section-head,
  .work-card-header,
  .sms-block-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .action-group-left,
  .action-group-right {
    width: 100%;
  }

  .quick-check-strip,
  .virtual-detail-meta-row {
    grid-template-columns: 1fr 1fr;
  }

  .virtual-detail-line-header,
  .phone-row,
  .pp-phone-select-row {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .main-title {
    font-size: 22px;
  }

  .quick-check-strip,
  .virtual-detail-meta-row {
    grid-template-columns: 1fr;
  }

  .phone-text {
    font-size: 18px;
  }


  .code-display-pending {
    font-size: 20px;
  }

  .work-card-body,
  .work-card-header,
  .work-card-footer,
  .action-bar {
    padding-left: 14px;
    padding-right: 14px;
  }

  .switch-button {
    flex: 1;
  }

  .list-switch {
    width: 100%;
  }
}
</style>
