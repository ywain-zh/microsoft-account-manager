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
              :loading="tableLoading"
              @click="loadAccounts"
            >
              刷新
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
            <n-button
              size="small"
              class="toolbar-button toolbar-button-rf"
              :loading="syncLoading"
              @click="refreshAccounts(false)"
            >
              刷新RF
            </n-button>
            <n-button
              size="small"
              class="toolbar-button toolbar-button-rf-batch"
              :loading="syncLoading"
              @click="refreshAccounts(true)"
            >
              批量刷新RF
            </n-button>
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
      v-model:show="tokenRefreshProgressVisible"
      preset="card"
      :bordered="false"
      class="console-modal token-refresh-progress-modal"
      title="Refresh Token 刷新进度"
    >
      <div class="token-refresh-progress">
        <div class="token-refresh-progress-head">
          <span>已处理 {{ tokenRefreshProgressCurrent }} / {{ tokenRefreshProgressTotal }}</span>
          <strong>成功 {{ tokenRefreshProgressSuccess }}，失败 {{ tokenRefreshProgressFailure }}</strong>
        </div>
        <n-progress
          type="line"
          :percentage="tokenRefreshProgressPercentage"
          :processing="syncLoading"
          :status="tokenRefreshProgressFailure > 0 ? 'warning' : tokenRefreshProgressPercentage >= 100 ? 'success' : 'default'"
        />
        <div class="token-refresh-log-list">
          <div
            v-for="(log, index) in tokenRefreshProgressLogs"
            :key="`${log.account}-${index}`"
            class="token-refresh-log-item"
            :class="log.ok === true ? 'is-success' : log.ok === false ? 'is-error' : 'is-running'"
          >
            <strong>{{ log.account }}</strong>
            <span>{{ log.message }}</span>
          </div>
          <div v-if="tokenRefreshProgressLogs.length === 0" class="token-refresh-log-empty">
            等待刷新任务开始
          </div>
        </div>
      </div>
    </n-modal>

    <n-modal
      v-model:show="createVisible"
      preset="card"
      :bordered="false"
      class="console-modal"
      title="新增账户"
    >
      <n-form label-placement="top" autocomplete="off">
        <n-grid :cols="24" :x-gap="14" :y-gap="8">
          <n-gi :span="24" :md="6">
            <n-form-item label="账号">
              <n-input v-model:value="createForm.account" placeholder="请输入账号" :input-props="accountInputProps" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="密码">
              <n-input
                v-model:value="createForm.password"
                type="text"
                placeholder="请输入密码"
                class="microsoft-secret-input"
                :input-props="accountPasswordInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Client ID（可选）">
              <n-input v-model:value="createForm.clientId" placeholder="client_id" :input-props="clientIdInputProps" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Client Secret（可选）">
              <n-input
                v-model:value="createForm.clientSecret"
                placeholder="client_secret"
                type="text"
                class="microsoft-secret-input"
                :input-props="clientSecretInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Refresh Token（可选）">
              <n-input v-model:value="createForm.refreshToken" placeholder="refresh_token" :input-props="refreshTokenInputProps" />
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
          placeholder="每行一个账号：账号----密码 或 账号----密码----client_id----refresh_token----client_secret"
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
      <n-form label-placement="top" autocomplete="off">
        <n-grid :cols="24" :x-gap="14" :y-gap="8">
          <n-gi :span="24" :md="6">
            <n-form-item label="账号">
              <n-input v-model:value="editForm.account" :input-props="accountInputProps" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="密码">
              <n-input
                v-model:value="editForm.password"
                type="text"
                class="microsoft-secret-input"
                :input-props="accountPasswordInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Client ID（可选）">
              <n-input v-model:value="editForm.clientId" :input-props="clientIdInputProps" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Client Secret（可选）">
              <n-input
                v-model:value="editForm.clientSecret"
                type="text"
                class="microsoft-secret-input"
                :input-props="clientSecretInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :md="6">
            <n-form-item label="Refresh Token（可选）">
              <n-input v-model:value="editForm.refreshToken" :input-props="refreshTokenInputProps" />
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
      <n-form label-placement="top" autocomplete="off" @submit.prevent>
        <n-form-item label="邮箱">
          <n-input :value="remarkForm.account" readonly :input-props="remarkAccountInputProps" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input
            v-model:value="remarkForm.remark"
            type="textarea"
            maxlength="500"
            show-count
            :autosize="{ minRows: 4, maxRows: 8 }"
            :input-props="remarkInputProps"
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
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
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
  NProgress,
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

const RefreshGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
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

const EyeGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
    [
      h('path', {
        d: 'M2.2 10c1.85-3.03 4.58-4.55 7.8-4.55S15.95 6.97 17.8 10c-1.85 3.03-4.58 4.55-7.8 4.55S4.05 13.03 2.2 10Z',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linejoin': 'round'
      }),
      h('circle', {
        cx: '10',
        cy: '10',
        r: '2.2',
        stroke: 'currentColor',
        'stroke-width': '1.5'
      })
    ]
  );

const EyeOffGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
    [
      h('path', {
        d: 'M3 3.5 17 16.5',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      }),
      h('path', {
        d: 'M6.12 6.4A8.8 8.8 0 0 1 10 5.45c3.22 0 5.95 1.52 7.8 4.55a13.22 13.22 0 0 1-2.5 2.89',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }),
      h('path', {
        d: 'M13.15 13.01A5.2 5.2 0 0 1 10 14.55c-3.22 0-5.95-1.52-7.8-4.55a13.1 13.1 0 0 1 2.79-3.11',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
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
  gptJsonExportLoading,
  tokenRefreshProgressVisible,
  tokenRefreshProgressTotal,
  tokenRefreshProgressCurrent,
  tokenRefreshProgressSuccess,
  tokenRefreshProgressFailure,
  tokenRefreshProgressLogs,
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
  batchDeleteAccounts,
  openMailModal,
  copyAccountValue,
  copyMailAccount,
  refreshMailInbox,
  exportSub2ApiGptJson,
  checkGptValidity,
  getGptValidityResult,
  isCheckingGptValidity,
  beginMicrosoftOauthLogin,
  consumeMicrosoftOauthResult,
  handleMicrosoftOauthMessage,
  handleMicrosoftOauthStorage,
  resolveTokenStatusLabel,
  resolveTokenStatusTone,
  formatMailDate,
  markMailAsRead,
  isAuthenticated,
  initialDataLoaded,
  oauthPopupLoading,
  updateAccountPassword,
  copyPasswordValue
} = admin;

const txtFileInputRef = ref<HTMLInputElement | null>(null);
const tablePage = ref(1);
const passwordDrafts = reactive<Record<number, string>>({});
const passwordSavingIds = ref<number[]>([]);
const passwordPendingValues = reactive<Record<number, string>>({});
const passwordVisibleIds = ref<number[]>([]);
const SEARCH_DEBOUNCE_MS = 300;
let searchDebounceTimer: number | null = null;

const noCredentialInputProps = {
  autocomplete: 'off',
  autocapitalize: 'none',
  autocorrect: 'off',
  spellcheck: 'false',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-form-type': 'other'
} as const;

const accountInputProps = {
  ...noCredentialInputProps,
  name: 'microsoft-mail-account-address'
} as const;

const clientIdInputProps = {
  ...noCredentialInputProps,
  name: 'microsoft-mail-client-id'
} as const;

const clientSecretInputProps = {
  ...noCredentialInputProps,
  autocomplete: 'new-password',
  name: 'microsoft-mail-client-secret',
  'aria-autocomplete': 'none'
} as const;

const refreshTokenInputProps = {
  ...noCredentialInputProps,
  name: 'microsoft-mail-refresh-token'
} as const;

const remarkAccountInputProps = {
  ...noCredentialInputProps,
  name: 'microsoft-mail-remark-account'
} as const;

const remarkInputProps = {
  ...noCredentialInputProps,
  name: 'microsoft-mail-remark-text'
} as const;

const accountPasswordInputProps = {
  ...noCredentialInputProps,
  autocomplete: 'new-password',
  name: 'microsoft-mail-account-secret',
  'aria-autocomplete': 'none'
} as const;

const rowKey = (row: AccountItem): number => row.id;

const pageCount = computed(() => Math.max(1, Math.ceil(accounts.value.length / tablePageSize.value)));
const pageOffset = computed(() => (tablePage.value - 1) * tablePageSize.value);
const pagedAccounts = computed(() => {
  const start = pageOffset.value;
  return accounts.value.slice(start, start + tablePageSize.value);
});
const tokenRefreshProgressPercentage = computed(() => {
  if (tokenRefreshProgressTotal.value <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((tokenRefreshProgressCurrent.value / tokenRefreshProgressTotal.value) * 100));
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

function getPasswordDraft(row: AccountItem): string {
  return passwordDrafts[row.id] ?? row.password ?? '';
}

function setPasswordSaving(id: number, saving: boolean): void {
  if (saving) {
    if (!passwordSavingIds.value.includes(id)) {
      passwordSavingIds.value = [...passwordSavingIds.value, id];
    }
    return;
  }

  passwordSavingIds.value = passwordSavingIds.value.filter((item) => item !== id);
}

function isPasswordSaving(id: number): boolean {
  return passwordSavingIds.value.includes(id);
}

function isPasswordVisible(id: number): boolean {
  return passwordVisibleIds.value.includes(id);
}

function togglePasswordVisible(id: number): void {
  if (isPasswordVisible(id)) {
    passwordVisibleIds.value = passwordVisibleIds.value.filter((item) => item !== id);
    return;
  }
  passwordVisibleIds.value = [...passwordVisibleIds.value, id];
}

function getPasswordCellInputProps(row: AccountItem): Record<string, string> {
  return {
    ...accountPasswordInputProps,
    name: `microsoft-mail-account-secret-${row.id}`
  };
}

async function saveInlinePassword(row: AccountItem): Promise<void> {
  const nextPassword = getPasswordDraft(row).trim();
  if (nextPassword === row.password) {
    return;
  }
  if (!nextPassword) {
    passwordDrafts[row.id] = row.password ?? '';
    return;
  }
  if (passwordPendingValues[row.id] === nextPassword) {
    return;
  }

  passwordPendingValues[row.id] = nextPassword;
  setPasswordSaving(row.id, true);
  try {
    const updated = await updateAccountPassword(row.id, nextPassword);
    if (updated) {
      passwordDrafts[row.id] = updated.password;
    }
  } finally {
    delete passwordPendingValues[row.id];
    setPasswordSaving(row.id, false);
  }
}

function renderPasswordCell(row: AccountItem): ReturnType<typeof h> {
  const draftValue = getPasswordDraft(row);
  const visible = isPasswordVisible(row.id);
  return h('div', { class: 'microsoft-password-cell' }, [
    h(NInput, {
      value: draftValue,
      size: 'small',
      type: 'text',
      placeholder: '输入密码',
      class: ['microsoft-password-input', !visible && 'microsoft-secret-input'],
      inputProps: getPasswordCellInputProps(row),
      loading: isPasswordSaving(row.id),
      disabled: isPasswordSaving(row.id),
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
      },
      'onUpdate:value': (value: string) => {
        passwordDrafts[row.id] = value;
      },
      onBlur: () => {
        void saveInlinePassword(row);
      },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void saveInlinePassword(row);
        }
      }
    }),
    h(
      'button',
      {
        type: 'button',
        class: 'table-icon-button microsoft-password-visibility-button',
        title: visible ? '隐藏密码' : '显示密码',
        'aria-label': `${visible ? '隐藏' : '显示'} ${row.account} 的密码`,
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          togglePasswordVisible(row.id);
        }
      },
      [h(visible ? EyeOffGlyph : EyeGlyph)]
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'table-icon-button microsoft-password-copy-button',
        title: '复制密码',
        'aria-label': `复制 ${row.account} 的密码`,
        disabled: !draftValue.trim(),
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          void copyPasswordValue(draftValue);
        }
      },
      [h(CopyGlyph)]
    )
  ]);
}

function renderGptValidityCell(row: AccountItem): ReturnType<typeof h> {
  const checking = isCheckingGptValidity(row.account);
  const result = getGptValidityResult(row.account) ?? row.gptValidity;
  const isValid = result?.valid === true;
  const isFailed = result && !isValid;
  const title = checking
    ? `正在检测 ${row.account} 的 GPT 是否有效`
    : result?.message
      ? `${result.message}，点击重新检测`
      : `检测 ${row.account} 的 GPT 是否有效`;

  return h('button', {
    type: 'button',
    class: [
      'gpt-validity-control',
      isValid ? 'is-valid' : '',
      isFailed ? 'is-failed' : '',
      checking ? 'is-checking' : ''
    ],
    disabled: checking,
    title,
    'aria-label': `检测 ${row.account} 的 GPT 是否有效`,
    onClick: (event: MouseEvent) => {
      event.stopPropagation();
      void checkGptValidity(row.account);
    }
  }, [
    isValid ? h('span', { class: 'gpt-validity-label' }, 'GPT有效') : null,
    h('span', { class: 'gpt-validity-refresh' }, [h(RefreshGlyph)])
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
    width: 220,
    render: (row) => renderEmailCell(row)
  },
  {
    title: '备注',
    key: 'remark',
    width: 170,
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
    width: 230,
    render: (row) => renderPasswordCell(row)
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
    title: 'GPT有效',
    key: 'gptValidity',
    width: 96,
    render: (row) => renderGptValidityCell(row)
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
    width: 148,
    render: (row) =>
      h('div', { class: 'action-cell action-cell-compact' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'table-action-button',
            disabled: gptJsonExportLoading.value,
            title: `导出 ${row.account} 的 GPT JSON`,
            'aria-label': `导出 ${row.account} 的 GPT JSON`,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              void exportSub2ApiGptJson(row.account);
            }
          },
          '导出'
        ),
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
  window.addEventListener('storage', handleMicrosoftOauthStorage);

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
  window.removeEventListener('storage', handleMicrosoftOauthStorage);
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
  --n-color: #ef4444 !important;
  --n-color-hover: #f87171 !important;
  --n-color-pressed: #dc2626 !important;
  --n-color-focus: #f87171 !important;
  --n-text-color: #ffffff !important;
  --n-text-color-hover: #ffffff !important;
  --n-text-color-pressed: #ffffff !important;
  --n-text-color-focus: #ffffff !important;
  --n-border: 1px solid #ef4444 !important;
  --n-border-hover: 1px solid #f87171 !important;
  --n-border-pressed: 1px solid #dc2626 !important;
  --n-border-focus: 1px solid #f87171 !important;
  --n-ripple-color: rgba(255, 255, 255, 0.24) !important;
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

:deep(.microsoft-toolbar .toolbar-button-rf) {
  --n-color: #ecfdf5 !important;
  --n-color-hover: #d1fae5 !important;
  --n-color-pressed: #a7f3d0 !important;
  --n-color-focus: #d1fae5 !important;
  --n-text-color: #047857 !important;
  --n-text-color-hover: #065f46 !important;
  --n-text-color-pressed: #065f46 !important;
  --n-text-color-focus: #065f46 !important;
  --n-border: 1px solid rgba(16, 185, 129, 0.36) !important;
  --n-border-hover: 1px solid rgba(5, 150, 105, 0.54) !important;
  --n-border-pressed: 1px solid rgba(5, 150, 105, 0.64) !important;
  --n-border-focus: 1px solid rgba(5, 150, 105, 0.54) !important;
  --n-ripple-color: rgba(16, 185, 129, 0.18) !important;
}

:deep(.microsoft-toolbar .toolbar-button-rf-batch) {
  --n-color: #f59e0b !important;
  --n-color-hover: #fbbf24 !important;
  --n-color-pressed: #d97706 !important;
  --n-color-focus: #fbbf24 !important;
  --n-text-color: #ffffff !important;
  --n-text-color-hover: #ffffff !important;
  --n-text-color-pressed: #ffffff !important;
  --n-text-color-focus: #ffffff !important;
  --n-border: 1px solid #f59e0b !important;
  --n-border-hover: 1px solid #fbbf24 !important;
  --n-border-pressed: 1px solid #d97706 !important;
  --n-border-focus: 1px solid #fbbf24 !important;
  --n-ripple-color: rgba(255, 255, 255, 0.24) !important;
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

:deep(.microsoft-account-table .microsoft-password-cell) {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) 28px 28px;
  max-width: 100%;
  align-items: center;
  gap: 8px;
}

:deep(.microsoft-account-table .microsoft-password-input .n-input-wrapper) {
  padding-inline: 10px;
}

:deep(.microsoft-account-table .microsoft-password-input .n-input__input-el) {
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  letter-spacing: 0;
}

:deep(.microsoft-secret-input .n-input__input-el) {
  -webkit-text-security: disc;
}

:deep(.microsoft-account-table .microsoft-password-copy-button) {
  width: 28px;
  height: 28px;
  border-radius: 8px;
}

:deep(.microsoft-account-table .microsoft-password-visibility-button) {
  width: 28px;
  height: 28px;
  border-radius: 8px;
}

:deep(.microsoft-account-table .microsoft-password-copy-button:disabled) {
  cursor: not-allowed;
  opacity: 0.45;
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

:deep(.microsoft-account-table .table-action-button:disabled) {
  cursor: not-allowed;
  opacity: 0.62;
}

:deep(.microsoft-account-table .gpt-validity-control) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 32px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: #eff6ff;
  color: #2563eb;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

:deep(.microsoft-account-table .gpt-validity-control:hover) {
  background: #dbeafe;
}

:deep(.microsoft-account-table .gpt-validity-control:disabled) {
  cursor: not-allowed;
  opacity: 0.62;
}

:deep(.microsoft-account-table .gpt-validity-control.is-valid) {
  min-width: 82px;
  background: #dcfce7;
  color: #15803d;
}

:deep(.microsoft-account-table .gpt-validity-control.is-valid:hover) {
  background: #bbf7d0;
  color: #166534;
}

:deep(.microsoft-account-table .gpt-validity-control.is-failed) {
  background: #fee2e2;
  color: #dc2626;
}

:deep(.microsoft-account-table .gpt-validity-control.is-failed:hover) {
  background: #fecaca;
}

:deep(.microsoft-account-table .gpt-validity-refresh) {
  display: inline-flex;
  width: 16px;
  height: 16px;
}

:deep(.microsoft-account-table .gpt-validity-refresh svg) {
  width: 16px;
  height: 16px;
}

:deep(.microsoft-account-table .gpt-validity-control.is-checking .gpt-validity-refresh) {
  animation: gpt-validity-spin 0.8s linear infinite;
}

@keyframes gpt-validity-spin {
  to {
    transform: rotate(360deg);
  }
}

:deep(.list-footer-card) {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.token-refresh-progress {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.token-refresh-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #334155;
  font-size: 13px;
}

.token-refresh-log-list {
  max-height: 320px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.token-refresh-log-item {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(0, 1.4fr);
  gap: 12px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
}

.token-refresh-log-item strong,
.token-refresh-log-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.token-refresh-log-item.is-success {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #15803d;
}

.token-refresh-log-item.is-error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.token-refresh-log-empty {
  padding: 20px 0;
  color: #94a3b8;
  text-align: center;
  font-size: 13px;
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
