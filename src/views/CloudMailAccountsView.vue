<template>
  <div class="page-stack page-stack-compact page-container mailbox-page mailbox-page-cloud">
    <AppListPanel class="content-card cloud-mail-card main-card mailbox-card">
      <template #toolbar>
        <div class="list-toolbar list-toolbar-spec list-toolbar-left-aligned cloud-toolbar">
          <div class="list-toolbar-block list-toolbar-block-search list-toolbar-block-search-wide">
            <n-input
              v-model:value="searchKeyword"
              clearable
              class="toolbar-search search-input cloud-search-input"
              placeholder="按邮箱搜索 Cloud Mail 账号"
              @keyup.enter="handleSearchInputEnter"
            >
              <template #prefix>
                <span class="toolbar-input-icon" aria-hidden="true">
                  <SearchGlyph />
                </span>
              </template>
            </n-input>
          </div>

          <div class="list-toolbar-block toolbar-button-group toolbar-button-group-iconic">
            <n-tag v-if="checkedRowKeys.length > 0" size="small" class="toolbar-selection-tag" type="warning">
              已选 {{ checkedRowKeys.length }} 条
            </n-tag>
            <n-button size="small" class="toolbar-button toolbar-button-muted" @click="openConfigModal">
              <template #icon>
                <GearGlyph />
              </template>
              配置信息
            </n-button>
            <n-button
              size="small"
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
          </div>

          <span class="toolbar-divider" aria-hidden="true"></span>

          <div class="list-toolbar-block toolbar-button-group toolbar-button-group-iconic">
            <n-button
              size="small"
              class="toolbar-button toolbar-button-primary"
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
              class="toolbar-button toolbar-button-danger"
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
      </template>

        <template v-if="hasConfiguredCloudMail">
          <div v-if="serviceErrorMessage" class="cloud-mail-service-alert">
            <div class="cloud-mail-service-alert-copy">
              <strong class="cloud-mail-service-alert-title">当前 Cloud Mail 配置不可用</strong>
              <p class="cloud-mail-service-alert-text">{{ serviceErrorMessage }}</p>
            </div>
            <n-button size="small" class="toolbar-button toolbar-button-muted" @click="openConfigModal">
              重新配置
            </n-button>
          </div>

          <div class="mailbox-table-shell mailbox-table-shell-cloud">
            <n-data-table
              class="account-table account-table-modern cloud-mail-account-table"
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

      <template #footer>
        <div v-if="hasConfiguredCloudMail" class="list-footer list-footer-card">
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
    </AppListPanel>

    <AppModal
      v-model:show="configVisible"
      title="Cloud Mail 配置信息"
      size="lg"
    >
      <n-form label-placement="top" autocomplete="off">
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="off" />
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
                class="cloud-mail-secret-input"
                :class="{ 'is-secret-visible': adminPasswordVisible }"
                type="text"
                :input-props="adminPasswordInputProps"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="input-icon-button"
                    :title="adminPasswordVisible ? '隐藏密码' : '显示密码'"
                    :aria-label="adminPasswordVisible ? '隐藏密码' : '显示密码'"
                    @mousedown.prevent
                    @click="adminPasswordVisible = !adminPasswordVisible"
                  >
                    <EyeOffGlyph v-if="adminPasswordVisible" />
                    <EyeGlyph v-else />
                  </button>
                </template>
              </n-input>
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
    </AppModal>

    <AppModal
      v-model:show="createVisible"
      title="新增邮箱"
      size="md"
      card-class="cloud-mail-create-modal"
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
    </AppModal>

    <AppModal
      v-model:show="remarkVisible"
      title="编辑备注"
      size="sm"
      card-class="cloud-mail-remark-modal"
    >
      <n-form label-placement="top" autocomplete="off">
        <n-form-item label="邮箱">
          <n-input :value="remarkForm.email" readonly />
        </n-form-item>
        <n-form-item label="备注">
          <n-input
            v-model:value="remarkForm.remark"
            type="textarea"
            maxlength="500"
            show-count
            :autosize="{ minRows: 4, maxRows: 8 }"
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button class="dialog-cancel-button" @click="closeRemarkModal">取消</n-button>
          <n-button class="dialog-primary-button" type="primary" :loading="remarkSaving" @click="saveRemark">
            保存备注
          </n-button>
        </n-space>
      </template>
    </AppModal>

    <MailInboxViewer
      :show="mailVisible"
      title="收件箱"
      :account="mailAccount"
      :items="mailItems"
      :loading="mailLoading"
      :selected-mail-id="selectedMailId"
      :format-date="formatDate"
      :on-copy="copyMailAccount"
      @update:show="handleMailVisibleChange"
      @select="selectMail"
      @refresh="refreshMailInbox"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  NButton,
  NDataTable,
  NForm,
  NFormItem,
  NGi,
  NGrid,
  NInput,
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

const RefreshGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M16 10a6 6 0 1 1-1.76-4.24',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }),
      h('path', {
        d: 'M16 5.5v3.5h-3.5',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
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
        'stroke-width': '2'
      }),
      h('path', {
        d: 'M16.25 10a1.2 1.2 0 0 0-.79-1.13l-.91-.32a4.95 4.95 0 0 0-.37-.9l.4-.87a1.2 1.2 0 0 0-.25-1.36l-.42-.42a1.2 1.2 0 0 0-1.36-.25l-.87.4c-.29-.15-.59-.27-.9-.37l-.32-.91A1.2 1.2 0 0 0 10 3.75h-.6a1.2 1.2 0 0 0-1.13.79l-.32.91c-.31.1-.61.22-.9.37l-.87-.4a1.2 1.2 0 0 0-1.36.25l-.42.42a1.2 1.2 0 0 0-.25 1.36l.4.87c-.15.29-.27.59-.37.9l-.91.32A1.2 1.2 0 0 0 3.75 10v.6c0 .52.33.98.79 1.13l.91.32c.1.31.22.61.37.9l-.4.87a1.2 1.2 0 0 0 .25 1.36l.42.42c.36.36.9.46 1.36.25l.87-.4c.29.15.59.27.9.37l.32.91c.15.46.61.79 1.13.79h.6c.52 0 .98-.33 1.13-.79l.32-.91c.31-.1.61-.22.9-.37l.87.4c.46.21 1 .11 1.36-.25l.42-.42c.36-.36.46-.9.25-1.36l-.4-.87c.15-.29.27-.59.37-.9l.91-.32c.46-.15.79-.61.79-1.13V10Z',
        stroke: 'currentColor',
        'stroke-width': '2',
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
        'stroke-width': '2',
        'stroke-linecap': 'round'
      }),
      h('path', {
        d: 'M4.5 10h11',
        stroke: 'currentColor',
        'stroke-width': '2',
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
        'stroke-width': '2',
        'stroke-linecap': 'round'
      }),
      h('path', {
        d: 'M8 3.75h4',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round'
      }),
      h('path', {
        d: 'm6.5 6.25.47 8.02c.05.8.71 1.42 1.51 1.42h2.98c.8 0 1.46-.62 1.51-1.42l.47-8.02',
        stroke: 'currentColor',
        'stroke-width': '2',
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

const PencilGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M4.75 13.75 4 16l2.25-.75 8-8a1.59 1.59 0 0 0-2.25-2.25l-8 8Z',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linejoin': 'round'
      }),
      h('path', {
        d: 'm10.75 4.75 2.5 2.5',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
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

const EyeGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M2.5 10s2.4-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.4 4.5-7.5 4.5S2.5 10 2.5 10Z',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }),
      h('path', {
        d: 'M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z',
        stroke: 'currentColor',
        'stroke-width': '1.5'
      })
    ]
  );

const EyeOffGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none' },
    [
      h('path', {
        d: 'M3 3l14 14',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      }),
      h('path', {
        d: 'M7.4 5.9A7.9 7.9 0 0 1 10 5.5c5.1 0 7.5 4.5 7.5 4.5a11.4 11.4 0 0 1-2.1 2.6M12.1 13.8a7.9 7.9 0 0 1-2.1.3C4.9 14.1 2.5 10 2.5 10a10.9 10.9 0 0 1 2.4-2.8',
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
  remarkSaving,
  configVisible,
  createVisible,
  mailVisible,
  remarkVisible,
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
  remarkForm,
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
  openRemarkModal,
  closeRemarkModal,
  saveRemark,
  handleSearch,
  handlePageChange,
  handlePageSizeChange,
  handleCheckedRowKeysUpdate,
  copyEmail,
  copyMailAccount,
  formatDate,
  openMailModal,
  refreshMailInbox,
  markMailAsRead
} = cloudMail;

const adminPasswordVisible = ref(false);

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
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'cloud-mail-admin-secret',
  inputmode: 'text',
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
const SEARCH_DEBOUNCE_MS = 300;
let searchDebounceTimer: number | null = null;

watch(searchKeyword, () => {
  scheduleSearch();
});

function clearSearchDebounce(): void {
  if (searchDebounceTimer !== null) {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

function scheduleSearch(): void {
  clearSearchDebounce();
  searchDebounceTimer = window.setTimeout(() => {
    searchDebounceTimer = null;
    void handleSearch();
  }, SEARCH_DEBOUNCE_MS);
}

function handleSearchInputEnter(): void {
  clearSearchDebounce();
  void handleSearch();
}

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

function renderRemarkCell(row: CloudMailAccountItem): ReturnType<typeof h> {
  return h('div', { class: 'cloud-mail-remark-cell' }, [
    h('div', { class: 'cloud-mail-remark-text', title: row.remark?.trim() || '-' }, row.remark?.trim() || '-'),
    h(
      'button',
      {
        type: 'button',
        class: 'cloud-mail-remark-edit-button',
        title: `编辑 ${row.email} 的备注`,
        'aria-label': `编辑 ${row.email} 的备注`,
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          openRemarkModal(row);
        }
      },
      [h(PencilGlyph)]
    )
  ]);
}

const columns: DataTableColumns<CloudMailAccountItem> = [
  {
    type: 'selection',
    width: 38
  },
  {
    title: '邮箱',
    key: 'email',
    width: 232,
    render: (row) => renderEmailCell(row)
  },
  {
    title: '备注',
    key: 'remark',
    width: 168,
    render: (row) => renderRemarkCell(row)
  },
  {
    title: '创建时间',
    key: 'createTime',
    width: 136,
    render: (row) => h('span', { class: 'plain-cell-text' }, formatDate(row.createTime))
  },
  {
    title: '操作',
    key: 'actions',
    width: 72,
    render: (row) =>
      h('div', { class: 'action-cell action-cell-compact' }, [
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
  void markMailAsRead(id);
}

function handleMailVisibleChange(value: boolean): void {
  mailVisible.value = value;
}

onMounted(async () => {
  if (!initialDataLoaded.value) {
    await loadInitialData();
  }
});

onUnmounted(() => {
  clearSearchDebounce();
});
</script>

<style scoped>
.mailbox-page-cloud {
  gap: 0;
}

.mailbox-page-header {
  margin-bottom: 24px;
}

.page-title-spec {
  display: flex;
  align-items: baseline;
  margin-bottom: 8px;
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

.mailbox-card-shell {
  display: grid;
  gap: 20px;
}

.mailbox-table-shell {
  overflow: hidden;
  border-radius: 8px;
}

.toolbar-input-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
}

.toolbar-input-icon :deep(svg) {
  width: 14px;
  height: 14px;
}

.cloud-mail-service-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid #fee2e2;
  border-radius: 12px;
  background: #fff7f7;
}

.cloud-mail-service-alert-title {
  display: block;
  margin-bottom: 4px;
  color: #1e293b;
  font-size: 14px;
  font-weight: 600;
}

.cloud-mail-service-alert-text {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
}

.cloud-mail-empty-shell {
  display: grid;
  justify-items: center;
  gap: 16px;
  padding: 44px 24px;
  border: 1px dashed #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
}

.cloud-mail-empty-note {
  max-width: 520px;
  margin: 0;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.7;
  text-align: center;
}

:deep(.cloud-mail-card) {
  border: 0 !important;
  background: #ffffff !important;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.03) !important;
}

:deep(.cloud-mail-card > .n-card__content) {
  display: block !important;
  padding: 24px !important;
}

:deep(.cloud-toolbar) {
  display: flex;
  align-items: center;
  justify-content: flex-start !important;
  gap: 10px;
  margin: 0;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  flex-wrap: wrap;
}

:deep(.cloud-toolbar .list-toolbar-block),
:deep(.cloud-toolbar .toolbar-button-group) {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

:deep(.cloud-toolbar .toolbar-divider) {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: #e2e8f0;
}

:deep(.cloud-toolbar .toolbar-search.search-input),
:deep(.cloud-toolbar .cloud-search-input) {
  width: 220px !important;
  flex: 0 0 220px !important;
}

:deep(.cloud-toolbar .n-input-wrapper) {
  min-height: 33px;
  border-radius: 6px;
}

:deep(.cloud-toolbar .n-button) {
  --n-height: 33px !important;
  --n-padding: 0 16px !important;
  --n-border-radius: 6px !important;
  --n-box-shadow-focus: none !important;
}

:deep(.cloud-toolbar .toolbar-button-muted),
:deep(.cloud-mail-service-alert .toolbar-button-muted) {
  --n-color: #ffffff !important;
  --n-color-hover: #ffffff !important;
  --n-color-pressed: #ffffff !important;
  --n-color-focus: #ffffff !important;
  --n-text-color: #1e293b !important;
  --n-text-color-hover: #409eff !important;
  --n-text-color-pressed: #409eff !important;
  --n-text-color-focus: #409eff !important;
  --n-border: 1px solid #e2e8f0 !important;
  --n-border-hover: 1px solid #409eff !important;
  --n-border-pressed: 1px solid #409eff !important;
  --n-border-focus: 1px solid #409eff !important;
  --n-ripple-color: rgba(64, 158, 255, 0.16) !important;
}

:deep(.cloud-toolbar .toolbar-button-primary),
:deep(.cloud-mail-service-alert .toolbar-button-primary) {
  --n-color: #409eff !important;
  --n-color-hover: #409eff !important;
  --n-color-pressed: #409eff !important;
  --n-color-focus: #409eff !important;
  --n-text-color: #ffffff !important;
  --n-text-color-hover: #ffffff !important;
  --n-text-color-pressed: #ffffff !important;
  --n-text-color-focus: #ffffff !important;
  --n-border: 1px solid #409eff !important;
  --n-border-hover: 1px solid #409eff !important;
  --n-border-pressed: 1px solid #409eff !important;
  --n-border-focus: 1px solid #409eff !important;
  --n-ripple-color: rgba(255, 255, 255, 0.22) !important;
}

:deep(.cloud-toolbar .toolbar-button-danger),
:deep(.cloud-mail-service-alert .toolbar-button-danger) {
  --n-color: transparent !important;
  --n-color-hover: #fef0f0 !important;
  --n-color-pressed: #fef0f0 !important;
  --n-color-focus: #fef0f0 !important;
  --n-text-color: #f56c6c !important;
  --n-text-color-hover: #f56c6c !important;
  --n-text-color-pressed: #f56c6c !important;
  --n-text-color-focus: #f56c6c !important;
  --n-border: 1px solid #f56c6c !important;
  --n-border-hover: 1px solid #f56c6c !important;
  --n-border-pressed: 1px solid #f56c6c !important;
  --n-border-focus: 1px solid #f56c6c !important;
  --n-ripple-color: rgba(245, 108, 108, 0.16) !important;
}

:deep(.cloud-toolbar .toolbar-button),
:deep(.cloud-mail-service-alert .toolbar-button) {
  border-radius: 6px !important;
  font-size: 13px;
  font-weight: 500;
}

:deep(.cloud-toolbar .n-button__content),
:deep(.cloud-mail-service-alert .n-button__content) {
  gap: 6px;
}

:deep(.cloud-toolbar .n-button__icon),
:deep(.cloud-mail-service-alert .n-button__icon) {
  margin-right: 0;
}

:deep(.cloud-toolbar .n-button__icon svg),
:deep(.cloud-mail-service-alert .n-button__icon svg) {
  width: 14px;
  height: 14px;
}

:deep(.cloud-mail-secret-input:not(.is-secret-visible) .n-input__input-el) {
  -webkit-text-security: disc;
  text-security: disc;
}

:deep(.cloud-mail-secret-input .input-icon-button) {
  color: #94a3b8;
}

:deep(.cloud-mail-secret-input .input-icon-button:hover) {
  color: #475569;
}

:deep(.cloud-mail-secret-input .input-icon-button svg) {
  width: 16px;
  height: 16px;
}

:deep(.cloud-mail-config-strip-spec) {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

:deep(.cloud-mail-config-item) {
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
}

:deep(.cloud-mail-summary-label) {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 500;
}

:deep(.cloud-mail-summary-value) {
  margin-top: 6px;
  color: #1e293b;
  font-size: 14px;
  font-weight: 600;
}

:deep(.cloud-mail-account-table) {
  border: 0 !important;
  border-radius: 0 !important;
  background: #ffffff !important;
}

:deep(.cloud-mail-account-table .n-data-table-base-table-header) {
  background: #f8fafc !important;
}

:deep(.cloud-mail-account-table .n-data-table-th),
:deep(.cloud-mail-account-table .n-data-table-td) {
  padding: 12px 12px !important;
  border-bottom-color: #f1f5f9 !important;
}

:deep(.cloud-mail-account-table .n-data-table-th) {
  color: #475569 !important;
  font-size: 13px;
  font-weight: 600;
  background: #f8fafc !important;
}

:deep(.cloud-mail-account-table .n-data-table-tr:hover .n-data-table-td) {
  background: #f8fafc !important;
}

:deep(.cloud-mail-account-table .n-data-table-th:nth-child(3)),
:deep(.cloud-mail-account-table .n-data-table-td:nth-child(3)) {
  text-align: left;
}

:deep(.cloud-mail-account-table .cloud-mail-remark-cell) {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
}

:deep(.cloud-mail-account-table .cloud-mail-remark-text) {
  min-width: 0;
  max-width: 100%;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.cloud-mail-account-table .cloud-mail-remark-edit-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: #f8fafc;
  color: #64748b;
  cursor: pointer;
}

:deep(.cloud-mail-account-table .cloud-mail-remark-edit-button:hover) {
  background: #e2e8f0;
  color: #334155;
}

:deep(.cloud-mail-account-table .cloud-mail-remark-edit-button svg) {
  width: 14px;
  height: 14px;
}
:deep(.cloud-mail-account-table .table-action-button) {
  padding: 4px 8px;
  border-radius: 4px;
  background: #f1f5f9 !important;
  color: #475569 !important;
  font-size: 12px;
  font-weight: 500;
}

:deep(.cloud-mail-account-table .table-action-button:hover) {
  background: #e2e8f0 !important;
  opacity: 1;
}

:deep(.cloud-mail-account-table .table-action-button-danger) {
  background: #fef0f0 !important;
  color: #f56c6c !important;
}

:deep(.cloud-mail-account-table .table-action-button-danger:hover) {
  background: #fef0f0 !important;
  opacity: 0.8;
}

:deep(.list-footer-card) {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

@media (max-width: 1024px) {
  :deep(.cloud-mail-config-strip-spec) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cloud-mail-service-alert {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 768px) {
  :deep(.cloud-toolbar .toolbar-divider) {
    display: none;
  }

  :deep(.cloud-toolbar .toolbar-search.search-input),
  :deep(.cloud-toolbar .cloud-search-input),
  :deep(.cloud-toolbar .list-toolbar-block),
  :deep(.cloud-toolbar .toolbar-button-group) {
    width: 100% !important;
    flex: 1 1 100% !important;
  }

  :deep(.cloud-mail-config-strip-spec) {
    grid-template-columns: 1fr;
  }
}
</style>
