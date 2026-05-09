<template>
  <div class="page-stack page-stack-compact page-container mailbox-page mailbox-page-microsoft">
    <n-card :bordered="false" size="small" class="content-card account-list-card main-card mailbox-card">
      <div class="mailbox-card-shell mailbox-card-shell-microsoft">
        <div class="list-toolbar list-toolbar-spec list-toolbar-left-aligned microsoft-toolbar">
          <div class="list-toolbar-block list-toolbar-block-search">
            <n-input
              v-model:value="searchKeyword"
              clearable
              class="toolbar-search search-input microsoft-search-input"
              placeholder="按邮箱搜索..."
              @keyup.enter="handleSearch"
            />
          </div>

          <div class="list-toolbar-block toolbar-button-group">
            <n-button
              size="small"
              class="toolbar-button toolbar-button-muted"
              :loading="syncLoading"
              @click="refreshAccounts(false)"
            >
              检测选中
            </n-button>
            <n-button
              size="small"
              class="toolbar-button toolbar-button-muted"
              :loading="syncLoading"
              @click="refreshAccounts(true)"
            >
              检测全部
            </n-button>
            <n-button size="small" class="toolbar-button toolbar-button-muted" @click="selectAll">全选</n-button>
            <n-button size="small" class="toolbar-button toolbar-button-muted" @click="selectInverse">反选</n-button>
          </div>

          <span class="toolbar-divider" aria-hidden="true"></span>

          <div class="list-toolbar-block toolbar-button-group">
            <n-tag v-if="checkedRowKeys.length > 0" size="small" class="toolbar-selection-tag" type="warning">
              已选 {{ checkedRowKeys.length }} 条
            </n-tag>
            <n-button
              size="small"
              class="toolbar-button toolbar-button-danger"
              :loading="batchDeleteLoading"
              :disabled="checkedRowKeys.length === 0"
              @click="batchDeleteAccounts"
            >
              批量删除
            </n-button>
            <n-button
              size="small"
              class="toolbar-button toolbar-button-muted"
              :loading="tableLoading"
              @click="loadAccounts"
            >
              刷新列表
            </n-button>
            <n-button
              size="small"
              class="toolbar-button toolbar-button-oauth"
              :loading="oauthPopupLoading"
              @click="beginMicrosoftOauthLogin"
            >
              OAuth 登录
            </n-button>
            <n-button
              size="small"
              class="toolbar-button toolbar-button-secondary-primary"
              @click="openCreateModal"
            >
              新增账户
            </n-button>
            <n-button
              size="small"
              class="toolbar-button toolbar-button-primary"
              @click="openImportModal"
            >
              批量导入
            </n-button>
          </div>
        </div>

        <div class="mailbox-table-shell mailbox-table-shell-microsoft">
          <n-data-table
            class="account-table account-table-modern microsoft-account-table"
            size="small"
            :bordered="false"
            :columns="accountColumns"
            :data="pagedAccounts"
            :row-key="rowKey"
            :loading="tableLoading"
            :checked-row-keys="checkedRowKeys"
            :pagination="false"
            max-height="620"
            @update:checked-row-keys="handleCheckedRowKeysUpdate"
          />
        </div>

        <div class="list-footer list-footer-card">
          <div class="list-footer-meta">共 {{ accounts.length }} 条</div>
          <n-pagination
            v-model:page="tablePage"
            v-model:page-size="tablePageSize"
            size="small"
            :item-count="accounts.length"
            :page-sizes="[10, 20, 50, 100]"
            show-size-picker
            show-quick-jumper
          />
        </div>
      </div>
    </n-card>

    <n-modal
      v-model:show="createVisible"
      preset="card"
      :bordered="false"
      class="console-modal"
      title="新增账户"
    >
      <n-form label-placement="top">
        <n-grid :cols="24" :x-gap="14" :y-gap="8">
          <n-gi :span="24" :md="6">
            <n-form-item label="账号">
              <n-input v-model:value="createForm.account" placeholder="请输入账号" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="密码">
              <n-input
                v-model:value="createForm.password"
                type="password"
                show-password-on="click"
                placeholder="请输入密码"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Client ID（可选）">
              <n-input v-model:value="createForm.clientId" placeholder="client_id" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Refresh Token（可选）">
              <n-input v-model:value="createForm.refreshToken" placeholder="refresh_token" />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button class="dialog-cancel-button" @click="createVisible = false">取消</n-button>
          <n-button class="dialog-primary-button" type="primary" :loading="createLoading" @click="createAccount">
            保存账户
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="importVisible"
      preset="card"
      :bordered="false"
      class="console-modal"
      title="批量导入"
    >
      <div class="import-modal-body">
        <n-input
          v-model:value="importText"
          type="textarea"
          :autosize="{ minRows: 7, maxRows: 12 }"
          placeholder="每行一个账号：账号----密码 或 账号----密码----client_id----refresh_token"
        />
        <p class="hint">支持手动输入或 TXT 文件导入，空行会自动忽略。</p>
      </div>

      <template #footer>
        <div class="import-modal-footer">
          <input
            ref="txtFileInputRef"
            class="hidden-file-input"
            type="file"
            accept=".txt,text/plain"
            @change="handleTxtFileChange"
          />
          <n-space justify="end">
            <n-button class="dialog-secondary-button" secondary :loading="importLoading" @click="triggerTxtImport">
              导入 TXT
            </n-button>
            <n-button class="dialog-primary-button" type="primary" :loading="importLoading" @click="handleImportText">
              导入文本
            </n-button>
          </n-space>
        </div>
      </template>
    </n-modal>

    <n-modal
      v-model:show="editVisible"
      preset="card"
      :bordered="false"
      class="console-modal"
      title="编辑账户"
    >
      <n-form label-placement="top">
        <n-grid :cols="24" :x-gap="14" :y-gap="8">
          <n-gi :span="24" :md="6">
            <n-form-item label="账号">
              <n-input v-model:value="editForm.account" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="密码">
              <n-input v-model:value="editForm.password" type="password" show-password-on="click" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Client ID（可选）">
              <n-input v-model:value="editForm.clientId" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Refresh Token（可选）">
              <n-input v-model:value="editForm.refreshToken" />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button class="dialog-cancel-button" @click="editVisible = false">取消</n-button>
          <n-button class="dialog-primary-button" type="primary" :loading="editLoading" @click="updateAccount">
            保存修改
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="remarkVisible"
      preset="card"
      :bordered="false"
      class="console-modal microsoft-remark-modal"
      title="编辑备注"
    >
      <n-form label-placement="top" autocomplete="off">
        <n-form-item label="邮箱">
          <n-input :value="remarkForm.account" readonly />
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
    </n-modal>

    <MailInboxViewer
      :show="mailVisible"
      title="邮箱邮件"
      :account="mailAccount"
      :items="mailItems"
      :loading="mailLoading"
      :selected-mail-id="selectedMailId"
      :format-date="formatMailDate"
      :on-copy="copyMailAccount"
      @update:show="handleMailVisibleChange"
      @select="selectMail"
      @refresh="refreshMailInbox"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  NSpace,
  NTag,
  type DataTableColumns
} from 'naive-ui';
import MailInboxViewer from '../components/MailInboxViewer.vue';
import { useAdminConsole } from '../state/admin-console';
import type { AccountItem } from '../types';

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

const admin = useAdminConsole();
const route = useRoute();
const router = useRouter();
const {
  accounts,
  searchKeyword,
  checkedRowKeys,
  tablePageSize,
  tableLoading,
  createLoading,
  editLoading,
  importLoading,
  syncLoading,
  batchDeleteLoading,
  createVisible,
  importVisible,
  editVisible,
  remarkSaving,
  remarkVisible,
  mailVisible,
  mailLoading,
  mailAccount,
  mailItems,
  selectedMailId,
  createForm,
  editForm,
  remarkForm,
  importText,
  loadAccounts,
  loadInitialData,
  openCreateModal,
  openImportModal,
  openEditModal,
  openRemarkModal,
  closeRemarkModal,
  handleCheckedRowKeysUpdate,
  createAccount,
  updateAccount,
  saveRemark,
  deleteAccount,
  importAccountsText,
  refreshAccounts,
  selectAll,
  selectInverse,
  batchDeleteAccounts,
  openMailModal,
  copyAccountValue,
  copyMailAccount,
  refreshMailInbox,
  beginMicrosoftOauthLogin,
  consumeMicrosoftOauthResult,
  handleMicrosoftOauthMessage,
  resolveTokenStatusLabel,
  resolveTokenStatusTone,
  formatMailDate,
  markMailAsRead,
  isAuthenticated,
  initialDataLoaded,
  oauthPopupLoading
} = admin;

const txtFileInputRef = ref<HTMLInputElement | null>(null);
const tablePage = ref(1);
const SEARCH_DEBOUNCE_MS = 300;
let searchDebounceTimer: number | null = null;

const rowKey = (row: AccountItem): number => row.id;

const pageCount = computed(() => Math.max(1, Math.ceil(accounts.value.length / tablePageSize.value)));
const pageOffset = computed(() => (tablePage.value - 1) * tablePageSize.value);
const pagedAccounts = computed(() => {
  const start = pageOffset.value;
  return accounts.value.slice(start, start + tablePageSize.value);
});

watch(searchKeyword, () => {
  tablePage.value = 1;
  scheduleSearch();
});

watch([accounts, tablePageSize], () => {
  if (tablePage.value > pageCount.value) {
    tablePage.value = pageCount.value;
  }
});

watch(tablePageSize, () => {
  tablePage.value = 1;
});

function handleSearch(): void {
  clearSearchDebounce();
  tablePage.value = 1;
  void loadAccounts();
}

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
    handleSearch();
  }, SEARCH_DEBOUNCE_MS);
}

function resolveToneClass(tone: 'success' | 'error' | 'warning' | 'default'): string {
  if (tone === 'success') {
    return 'status-pill-success';
  }
  if (tone === 'error') {
    return 'status-pill-error';
  }
  if (tone === 'warning') {
    return 'status-pill-warning';
  }
  return 'status-pill-default';
}

function renderEmailCell(row: AccountItem): ReturnType<typeof h> {
  return h('div', { class: 'account-cell' }, [
    h(
      'button',
      {
        type: 'button',
        class: 'account-link',
        title: row.account,
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          void openMailModal(row);
        }
      },
      row.account
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'table-icon-button',
        title: '复制邮箱',
        'aria-label': `复制邮箱 ${row.account}`,
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          void copyAccountValue(row.account);
        }
      },
      [h(CopyGlyph)]
    )
  ]);
}

function renderAuthTypeCell(row: AccountItem): ReturnType<typeof h> {
  const label = row.authType === 'microsoft_oauth' ? 'OAuth' : '手动';
  const toneClass = row.authType === 'microsoft_oauth' ? 'status-pill-success' : 'status-pill-default';
  return h('span', { class: ['status-pill', toneClass] }, label);
}

function renderRemarkCell(row: AccountItem): ReturnType<typeof h> {
  const remark = row.remark?.trim() || '-';
  return h('div', { class: 'microsoft-remark-cell' }, [
    h('div', { class: 'microsoft-remark-text', title: remark }, remark),
    h(
      'button',
      {
        type: 'button',
        class: 'microsoft-remark-edit-button',
        title: `编辑 ${row.account} 的备注`,
        'aria-label': `编辑 ${row.account} 的备注`,
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          openRemarkModal(row);
        }
      },
      [h(PencilGlyph)]
    )
  ]);
}

const accountColumns: DataTableColumns<AccountItem> = [
  {
    type: 'selection',
    width: 38
  },
  {
    title: '邮箱',
    key: 'account',
    width: 250,
    render: (row) => renderEmailCell(row)
  },
  {
    title: '备注',
    key: 'remark',
    width: 180,
    render: (row) => renderRemarkCell(row)
  },
  {
    title: '来源',
    key: 'authType',
    width: 84,
    render: (row) => renderAuthTypeCell(row)
  },

  {
    title: '密码',
    key: 'password',
    width: 92,
    render: (row) =>
      h('span', { class: 'plain-cell-text plain-cell-text-compact', title: row.password }, row.password)
  },
  {
    title: '邮箱状态',
    key: 'tokenStatus',
    width: 88,
    render: (row) =>
      h(
        'span',
        {
          class: ['status-pill', resolveToneClass(resolveTokenStatusTone(row.tokenStatus))],
          title: row.tokenMessage ?? resolveTokenStatusLabel(row)
        },
        resolveTokenStatusLabel(row)
      )
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 132,
    render: (row) =>
      h('span', { class: 'plain-cell-text plain-cell-text-compact', title: formatMailDate(row.createdAt) }, formatMailDate(row.createdAt))
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render: (row) =>
      h('div', { class: 'action-cell action-cell-compact' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'table-action-button',
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              openEditModal(row);
            }
          },
          '编辑'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'table-action-button table-action-button-danger',
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              void deleteAccount(row.id);
            }
          },
          '删除'
        )
      ])
  }
];

function triggerTxtImport(): void {
  txtFileInputRef.value?.click();
}

async function handleTxtFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    await importAccountsText(text, `TXT 文件 ${file.name}`);
  } finally {
    input.value = '';
  }
}

async function handleImportText(): Promise<void> {
  await importAccountsText(importText.value, '文本内容');
}

function selectMail(id: string): void {
  selectedMailId.value = id;
  void markMailAsRead(id);
}

function handleMailVisibleChange(value: boolean): void {
  mailVisible.value = value;
}

onMounted(async () => {
  window.addEventListener('message', handleMicrosoftOauthMessage);

  if (!initialDataLoaded.value && isAuthenticated.value) {
    await loadInitialData();
  }

  await consumeMicrosoftOauthResult(route.query);
  if (route.query.oauth) {
    await router.replace({ path: route.path, query: {} });
  }
});

onUnmounted(() => {
  clearSearchDebounce();
  window.removeEventListener('message', handleMicrosoftOauthMessage);
});
</script>

<style scoped>
.mailbox-page-microsoft {
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

:deep(.account-list-card > .n-card__content) {
  padding: 24px !important;
}

:deep(.microsoft-toolbar) {
  display: flex;
  align-items: center;
  justify-content: flex-start !important;
  gap: 12px;
  margin: 0;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  flex-wrap: wrap;
}

:deep(.microsoft-toolbar .list-toolbar-block),
:deep(.microsoft-toolbar .toolbar-button-group) {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

:deep(.microsoft-toolbar .toolbar-divider) {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: #e2e8f0;
}

:deep(.microsoft-toolbar .toolbar-search.search-input),
:deep(.microsoft-toolbar .microsoft-search-input) {
  width: 220px !important;
  flex: 0 0 220px !important;
}

:deep(.microsoft-toolbar .n-input-wrapper) {
  min-height: 33px;
  border-radius: 6px;
}

:deep(.microsoft-toolbar .n-button) {
  --n-height: 33px !important;
  --n-padding: 0 16px !important;
  --n-border-radius: 6px !important;
  --n-box-shadow-focus: none !important;
}

:deep(.microsoft-toolbar .toolbar-button) {
  border-radius: 6px !important;
  font-size: 13px;
  font-weight: 500;
}

:deep(.microsoft-toolbar .toolbar-button-muted) {
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

:deep(.microsoft-toolbar .toolbar-button-danger) {
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


:deep(.microsoft-toolbar .toolbar-button-oauth) {
  --n-color: #eff6ff !important;
  --n-color-hover: #dbeafe !important;
  --n-color-pressed: #dbeafe !important;
  --n-color-focus: #dbeafe !important;
  --n-text-color: #2563eb !important;
  --n-text-color-hover: #1d4ed8 !important;
  --n-text-color-pressed: #1d4ed8 !important;
  --n-text-color-focus: #1d4ed8 !important;
  --n-border: 1px solid rgba(37, 99, 235, 0.24) !important;
  --n-border-hover: 1px solid rgba(29, 78, 216, 0.32) !important;
  --n-border-pressed: 1px solid rgba(29, 78, 216, 0.32) !important;
  --n-border-focus: 1px solid rgba(29, 78, 216, 0.32) !important;
  --n-ripple-color: rgba(37, 99, 235, 0.16) !important;
}

:deep(.microsoft-toolbar .toolbar-button-secondary-primary) {
  --n-color: #ffffff !important;
  --n-color-hover: #ecf5ff !important;
  --n-color-pressed: #d9ecff !important;
  --n-color-focus: #ecf5ff !important;
  --n-text-color: #409eff !important;
  --n-text-color-hover: #409eff !important;
  --n-text-color-pressed: #409eff !important;
  --n-text-color-focus: #409eff !important;
  --n-border: 1px solid rgba(64, 158, 255, 0.56) !important;
  --n-border-hover: 1px solid #409eff !important;
  --n-border-pressed: 1px solid #409eff !important;
  --n-border-focus: 1px solid #409eff !important;
  --n-ripple-color: rgba(64, 158, 255, 0.16) !important;
}

:deep(.microsoft-toolbar .toolbar-button-primary) {
  --n-color: #409eff !important;
  --n-color-hover: #66b1ff !important;
  --n-color-pressed: #409eff !important;
  --n-color-focus: #66b1ff !important;
  --n-text-color: #ffffff !important;
  --n-text-color-hover: #ffffff !important;
  --n-text-color-pressed: #ffffff !important;
  --n-text-color-focus: #ffffff !important;
  --n-border: 1px solid #409eff !important;
  --n-border-hover: 1px solid #66b1ff !important;
  --n-border-pressed: 1px solid #409eff !important;
  --n-border-focus: 1px solid #66b1ff !important;
  --n-ripple-color: rgba(255, 255, 255, 0.22) !important;
}

:deep(.toolbar-selection-tag) {
  margin-right: 0;
}

:deep(.toolbar-selection-tag.n-tag) {
  border-radius: 999px;
  --n-color: #fef3c7 !important;
  --n-text-color: #92400e !important;
  --n-border-radius: 999px !important;
}

:deep(.microsoft-account-table) {
  border-radius: 0 !important;
  background: #ffffff !important;
}

:deep(.microsoft-account-table .n-data-table-base-table-header) {
  background: #f8fafc !important;
}

:deep(.microsoft-account-table .n-data-table-th),
:deep(.microsoft-account-table .n-data-table-td) {
  padding: 14px 16px !important;
  border-bottom-color: #f1f5f9 !important;
}

:deep(.microsoft-account-table .n-data-table-th) {
  color: #475569 !important;
  font-size: 13px;
  font-weight: 600;
  background: #f8fafc !important;
}

:deep(.microsoft-account-table .n-data-table-tr:hover .n-data-table-td) {
  background: #f8fafc !important;
}

:deep(.microsoft-account-table .microsoft-remark-cell) {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
}

:deep(.microsoft-account-table .microsoft-remark-text) {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.microsoft-account-table .microsoft-remark-edit-button) {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: #f8fafc;
  color: #64748b;
  cursor: pointer;
}

:deep(.microsoft-account-table .microsoft-remark-edit-button:hover) {
  background: #e2e8f0;
  color: #334155;
}

:deep(.microsoft-account-table .microsoft-remark-edit-button svg) {
  width: 14px;
  height: 14px;
}

:deep(.microsoft-account-table .n-data-table-td:nth-child(6) .status-pill) {
  min-height: auto;
  padding: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  font-weight: 500;
}

:deep(.microsoft-account-table .n-data-table-td:nth-child(6) .status-pill-success) {
  color: #10b981 !important;
}

:deep(.microsoft-account-table .n-data-table-td:nth-child(6) .status-pill-warning) {
  color: #f59e0b !important;
}

:deep(.microsoft-account-table .n-data-table-td:nth-child(6) .status-pill-error) {
  color: #f56c6c !important;
}

:deep(.microsoft-account-table .n-data-table-td:nth-child(6) .status-pill-default) {
  color: #94a3b8 !important;
}

:deep(.microsoft-account-table .table-action-button) {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
}

:deep(.list-footer-card) {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

@media (max-width: 768px) {
  :deep(.microsoft-toolbar .toolbar-divider) {
    display: none;
  }

  :deep(.microsoft-toolbar .toolbar-search.search-input),
  :deep(.microsoft-toolbar .microsoft-search-input),
  :deep(.microsoft-toolbar .list-toolbar-block),
  :deep(.microsoft-toolbar .toolbar-button-group) {
    width: 100% !important;
    flex: 1 1 100% !important;
  }
}
</style>
