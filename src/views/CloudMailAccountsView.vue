<template>
  <div class="page-stack page-stack-compact page-container">
    <section class="page-header">
      <h1 class="main-title">Cloud Mail 邮箱管理</h1>
      <p class="page-desc">维护 Cloud Mail 服务配置、域名与邮箱账号，点击邮箱即可查看最近邮件。</p>
    </section>

    <n-card :bordered="false" size="small" class="content-card cloud-mail-card main-card">
      <div class="list-toolbar list-toolbar-compact list-toolbar-spec toolbar">
        <div class="list-toolbar-left">
          <n-input
            v-model:value="searchKeyword"
            clearable
            class="toolbar-search search-input"
            placeholder="按邮箱搜索 Cloud Mail 账号"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <span class="toolbar-input-icon" aria-hidden="true">
                <SearchGlyph />
              </span>
            </template>
          </n-input>
        </div>

        <div class="list-toolbar-right">
          <n-tag v-if="checkedRowKeys.length > 0" size="small" class="toolbar-selection-tag" type="warning">
            已选 {{ checkedRowKeys.length }} 条
          </n-tag>
          <n-button size="small" class="toolbar-button toolbar-button-muted" secondary @click="openConfigModal">
            <template #icon>
              <GearGlyph />
            </template>
            配置信息
          </n-button>
          <n-button
            size="small"
            secondary
            class="toolbar-button toolbar-button-muted"
            :loading="tableLoading"
            :disabled="!hasConfiguredCloudMail"
            @click="refreshAccounts"
          >
            <template #icon>
              <RefreshGlyph />
            </template>
            刷新
          </n-button>
          <n-button
            size="small"
            class="toolbar-button toolbar-button-secondary-primary"
            type="primary"
            secondary
            :disabled="!hasConfiguredCloudMail || availableDomains.length === 0"
            @click="openCreateModal"
          >
            <template #icon>
              <PlusGlyph />
            </template>
            新增邮箱
          </n-button>
          <n-button
            size="small"
            ghost
            class="toolbar-button toolbar-button-danger"
            type="error"
            :loading="deleteLoading"
            :disabled="!hasConfiguredCloudMail || checkedRowKeys.length === 0"
            @click="deleteSelectedAccounts"
          >
            <template #icon>
              <TrashGlyph />
            </template>
            删除
          </n-button>
        </div>
      </div>

      <template v-if="hasConfiguredCloudMail">
        <div class="cloud-mail-config-strip">
          <div class="cloud-mail-config-item">
            <span class="cloud-mail-summary-label">API URI</span>
            <strong class="cloud-mail-summary-value">{{ storedConfig.apiBaseUrl }}</strong>
          </div>
          <div class="cloud-mail-config-item">
            <span class="cloud-mail-summary-label">管理员邮箱</span>
            <strong class="cloud-mail-summary-value">{{ storedConfig.adminEmail }}</strong>
          </div>
          <div class="cloud-mail-config-item">
            <span class="cloud-mail-summary-label">管理员密码</span>
            <strong class="cloud-mail-summary-value">{{ maskedAdminPassword }}</strong>
          </div>
          <div class="cloud-mail-config-item">
            <span class="cloud-mail-summary-label">可用域名</span>
            <strong class="cloud-mail-summary-value">{{ availableDomainsDisplay }}</strong>
          </div>
        </div>

        <div v-if="serviceErrorMessage" class="cloud-mail-service-alert">
          <div class="cloud-mail-service-alert-copy">
            <strong class="cloud-mail-service-alert-title">当前 Cloud Mail 配置不可用</strong>
            <p class="cloud-mail-service-alert-text">{{ serviceErrorMessage }}</p>
          </div>
          <n-button size="small" secondary @click="openConfigModal">重新配置</n-button>
        </div>

        <n-data-table
          class="account-table account-table-modern"
          size="small"
          :bordered="false"
          :columns="columns"
          :data="accounts"
          :row-key="rowKey"
          :loading="tableLoading"
          :checked-row-keys="checkedRowKeys"
          :pagination="false"
          max-height="620"
          @update:checked-row-keys="handleCheckedRowKeysUpdate"
        />

        <div class="list-footer list-footer-card">
          <div class="list-footer-meta">共 {{ total }} 条</div>
          <n-pagination
            :page="tablePage"
            :page-size="tablePageSize"
            size="small"
            :item-count="total"
            :page-sizes="[10, 20, 50, 100]"
            show-size-picker
            show-quick-jumper
            @update:page="handlePageChange"
            @update:page-size="handlePageSizeChange"
          />
        </div>
      </template>

      <div v-else class="cloud-mail-empty-shell">
        <div class="cloud-mail-empty-badge" aria-hidden="true">
          <CloudGlyph />
        </div>
        <n-empty description="尚未配置 Cloud Mail 服务">
          <template #extra>
            <n-button class="empty-primary-button" type="primary" @click="openConfigModal">
              先配置 Cloud Mail
            </n-button>
          </template>
        </n-empty>
        <p class="cloud-mail-empty-note">
          保存 API URI、管理员邮箱、管理员密码与可用域名后，就可以直接在这里拉取邮箱列表、新增邮箱和批量删除。
        </p>
      </div>
    </n-card>

    <n-modal
      v-model:show="configVisible"
      preset="card"
      :bordered="false"
      class="console-modal"
      title="Cloud Mail 配置信息"
    >
      <n-form label-placement="top" autocomplete="off">
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="username" />
          <input type="password" tabindex="-1" autocomplete="current-password" />
        </div>
        <n-grid :cols="24" :x-gap="14" :y-gap="8">
          <n-gi :span="24">
            <n-form-item label="API URI">
              <n-input v-model:value="configForm.apiBaseUrl" :input-props="apiUriInputProps" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :m="12">
            <n-form-item label="管理员邮箱">
              <n-input v-model:value="configForm.adminEmail" :input-props="adminEmailInputProps" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :m="12">
            <n-form-item label="管理员密码">
              <n-input
                v-model:value="configForm.adminPassword"
                type="password"
                show-password-on="click"
                :input-props="adminPasswordInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24">
            <n-form-item label="可用域名">
              <n-input
                v-model:value="configForm.availableDomainsText"
                type="textarea"
                :autosize="{ minRows: 4, maxRows: 8 }"
                :input-props="availableDomainsInputProps"
              />
            </n-form-item>
            <p class="hint">支持按换行或英文逗号拆分，保存时会自动去重并转为小写。</p>
          </n-gi>
        </n-grid>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button class="dialog-cancel-button" @click="configVisible = false">取消</n-button>
          <n-button class="dialog-primary-button" type="primary" :loading="configSaving" @click="saveConfig">
            保存配置
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="createVisible"
      preset="card"
      :bordered="false"
      class="console-modal cloud-mail-create-modal"
      title="新增邮箱"
    >
      <n-form label-placement="top" autocomplete="off">
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="username" />
          <input type="password" tabindex="-1" autocomplete="current-password" />
        </div>
        <n-form-item label="邮箱前缀@域名">
          <div class="cloud-mail-address-builder">
            <n-input
              v-model:value="createForm.localPart"
              class="cloud-mail-address-local-part"
              placeholder="请输入邮箱前缀"
              :input-props="localPartInputProps"
            >
              <template #suffix>
                <button
                  type="button"
                  class="input-icon-button"
                  title="随机生成邮箱前缀"
                  aria-label="随机生成邮箱前缀"
                  @mousedown.prevent
                  @click="fillRandomLocalPart"
                >
                  <SparkGlyph />
                </button>
              </template>
            </n-input>
            <span class="cloud-mail-address-separator" aria-hidden="true">@</span>
            <n-select
              v-model:value="createForm.domain"
              class="cloud-mail-address-domain"
              :options="domainOptions"
              placeholder="请选择域名"
            />
          </div>
        </n-form-item>

        <div class="cloud-mail-preview">
          <span class="cloud-mail-preview-label">将创建为</span>
          <strong class="cloud-mail-preview-value">{{ previewEmail }}</strong>
        </div>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button class="dialog-cancel-button" @click="createVisible = false">取消</n-button>
          <n-button class="dialog-primary-button" type="primary" :loading="createLoading" @click="createAccount">
            确认新增
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <MailInboxViewer
      :show="mailVisible"
      title="收件箱"
      subtitle="展示该邮箱最近收取的 Cloud Mail 邮件"
      :account="mailAccount"
      :items="mailItems"
      :loading="mailLoading"
      :selected-mail-id="selectedMailId"
      :format-date="formatDate"
      :show-junk-badge="false"
      @update:show="handleMailVisibleChange"
      @select="selectMail"
      @copy="copyMailAccount"
      @refresh="refreshMailInbox"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted } from 'vue';
import {
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NGi,
  NGrid,
  NInput,
  NModal,
  NPagination,
  NSelect,
  NSpace,
  NTag,
  type DataTableColumns
} from 'naive-ui';
import MailInboxViewer from '../components/MailInboxViewer.vue';
import { useCloudMailConsole } from '../state/cloud-mail-console';
import type { CloudMailAccountItem } from '../types';

const SearchGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M8.75 14a5.25 5.25 0 1 1 0-10.5 5.25 5.25 0 0 1 0 10.5Z',
        stroke: 'currentColor',
        'stroke-width': '1.5'
      }),
      h('path', {
        d: 'm12.5 12.5 4 4',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      })
    ]
  );

const GearGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M10 12.5A2.5 2.5 0 1 0 10 7.5a2.5 2.5 0 0 0 0 5Z',
        stroke: 'currentColor',
        'stroke-width': '1.5'
      }),
      h('path', {
        d: 'M16.25 10a1.2 1.2 0 0 0-.79-1.13l-.91-.32a4.95 4.95 0 0 0-.37-.9l.4-.87a1.2 1.2 0 0 0-.25-1.36l-.42-.42a1.2 1.2 0 0 0-1.36-.25l-.87.4c-.29-.15-.59-.27-.9-.37l-.32-.91A1.2 1.2 0 0 0 10 3.75h-.6a1.2 1.2 0 0 0-1.13.79l-.32.91c-.31.1-.61.22-.9.37l-.87-.4a1.2 1.2 0 0 0-1.36.25l-.42.42a1.2 1.2 0 0 0-.25 1.36l.4.87c-.15.29-.27.59-.37.9l-.91.32A1.2 1.2 0 0 0 3.75 10v.6c0 .52.33.98.79 1.13l.91.32c.1.31.22.61.37.9l-.4.87a1.2 1.2 0 0 0 .25 1.36l.42.42c.36.36.9.46 1.36.25l.87-.4c.29.15.59.27.9.37l.32.91c.15.46.61.79 1.13.79h.6c.52 0 .98-.33 1.13-.79l.32-.91c.31-.1.61-.22.9-.37l.87.4c.46.21 1 .11 1.36-.25l.42-.42c.36-.36.46-.9.25-1.36l-.4-.87c.15-.29.27-.59.37-.9l.91-.32c.46-.15.79-.61.79-1.13V10Z',
        stroke: 'currentColor',
        'stroke-width': '1.15',
        'stroke-linejoin': 'round'
      })
    ]
  );

const PlusGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M10 4.5v11',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      }),
      h('path', {
        d: 'M4.5 10h11',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      })
    ]
  );

const TrashGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M5.75 6.25h8.5',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      }),
      h('path', {
        d: 'M8 3.75h4',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      }),
      h('path', {
        d: 'm6.5 6.25.47 8.02c.05.8.71 1.42 1.51 1.42h2.98c.8 0 1.46-.62 1.51-1.42l.47-8.02',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      })
    ]
  );

const CopyGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
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

const SparkGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M10 2.75 11.42 7l4.25 1.42L11.42 9.84 10 14.09 8.58 9.84 4.33 8.42 8.58 7 10 2.75Z',
        stroke: 'currentColor',
        'stroke-width': '1.2',
        'stroke-linejoin': 'round'
      }),
      h('path', {
        d: 'm14.75 12.25.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z',
        fill: 'currentColor'
      })
    ]
  );

const CloudGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none' },
    [
      h('path', {
        d: 'M7.25 18.25h9.5a4 4 0 0 0 .3-7.99A5.75 5.75 0 0 0 6.06 8.1a3.75 3.75 0 0 0 1.19 10.15Z',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      })
    ]
  );

const cloudMail = useCloudMailConsole();
const {
  initialDataLoaded,
  tableLoading,
  configSaving,
  createLoading,
  deleteLoading,
  mailLoading,
  configVisible,
  createVisible,
  mailVisible,
  serviceErrorMessage,
  searchKeyword,
  tablePage,
  tablePageSize,
  total,
  checkedRowKeys,
  accounts,
  mailAccount,
  mailItems,
  selectedMailId,
  storedConfig,
  configForm,
  createForm,
  hasConfiguredCloudMail,
  availableDomains,
  loadInitialData,
  openConfigModal,
  saveConfig,
  openCreateModal,
  fillRandomLocalPart,
  createAccount,
  deleteSelectedAccounts,
  deleteSingleAccount,
  refreshAccounts,
  handleSearch,
  handlePageChange,
  handlePageSizeChange,
  handleCheckedRowKeysUpdate,
  copyEmail,
  copyMailAccount,
  formatDate,
  openMailModal,
  refreshMailInbox
} = cloudMail;

const apiUriInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'cloud-mail-api-uri',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

const adminEmailInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'cloud-mail-admin-email',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

const adminPasswordInputProps = {
  autocomplete: 'new-password',
  name: 'cloud-mail-admin-password',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

const availableDomainsInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'cloud-mail-available-domains',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

const localPartInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'cloud-mail-local-part',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

const rowKey = (row: CloudMailAccountItem): number => row.userId;

const availableDomainsDisplay = computed(() => {
  return availableDomains.value.length > 0 ? availableDomains.value.join(' / ') : '未配置';
});

const maskedAdminPassword = computed(() => {
  const source = storedConfig.adminPassword.trim();
  if (!source) {
    return '未配置';
  }
  return '*'.repeat(Math.max(8, Math.min(source.length, 16)));
});

const domainOptions = computed(() => {
  return availableDomains.value.map((domain) => ({
    label: domain,
    value: domain
  }));
});

const previewEmail = computed(() => {
  const localPart = createForm.localPart.trim();
  const domain = createForm.domain.trim();
  if (!localPart || !domain) {
    return 'local-part@example.com';
  }
  return `${localPart}@${domain}`;
});

function renderEmailCell(row: CloudMailAccountItem): ReturnType<typeof h> {
  return h('div', { class: 'account-cell cloud-mail-account-cell' }, [
    h(
      'button',
      {
        type: 'button',
        class: 'account-link cloud-mail-account-link',
        title: row.email,
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          void openMailModal(row);
        }
      },
      row.email
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'table-icon-button',
        title: '复制邮箱',
        'aria-label': `复制邮箱 ${row.email}`,
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          void copyEmail(row.email);
        }
      },
      [h(CopyGlyph)]
    )
  ]);
}

function renderCountCell(value: number): ReturnType<typeof h> {
  return h('span', { class: 'code-chip cloud-mail-count-chip' }, String(value));
}

const columns: DataTableColumns<CloudMailAccountItem> = [
  {
    type: 'selection',
    width: 38
  },
  {
    title: '邮箱',
    key: 'email',
    width: 248,
    render: (row) => renderEmailCell(row)
  },
  {
    title: '收件数',
    key: 'receiveEmailCount',
    width: 72,
    render: (row) => renderCountCell(row.receiveEmailCount)
  },
  {
    title: '发件数',
    key: 'sendEmailCount',
    width: 72,
    render: (row) => renderCountCell(row.sendEmailCount)
  },
  {
    title: '最近活跃时间',
    key: 'activeTime',
    width: 148,
    render: (row) => h('span', { class: 'plain-cell-text' }, formatDate(row.activeTime))
  },
  {
    title: '创建时间',
    key: 'createTime',
    width: 148,
    render: (row) => h('span', { class: 'plain-cell-text' }, formatDate(row.createTime))
  },
  {
    title: '操作',
    key: 'actions',
    width: 90,
    render: (row) =>
      h('div', { class: 'action-cell action-cell-compact' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'table-action-button',
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              void copyEmail(row.email);
            }
          },
          '复制'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'table-action-button table-action-button-danger',
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              void deleteSingleAccount(row);
            }
          },
          '删除'
        )
      ])
  }
];

function selectMail(id: string): void {
  selectedMailId.value = id;
}

function handleMailVisibleChange(value: boolean): void {
  mailVisible.value = value;
}

onMounted(async () => {
  if (!initialDataLoaded.value) {
    await loadInitialData();
  }
});
</script>
