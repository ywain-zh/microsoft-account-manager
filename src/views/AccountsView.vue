<template>
  <div class="page-stack">
    <n-card size="small" class="content-card account-list-card">
      <div class="list-toolbar list-toolbar-compact">
        <div class="list-toolbar-left">
          <n-input
            v-model:value="searchKeyword"
            clearable
            class="toolbar-search"
            placeholder="按邮箱搜索"
            @keyup.enter="handleSearch"
          />
        </div>

        <div class="list-toolbar-right">
          <n-tag v-if="checkedRowKeys.length > 0" size="small" type="warning">
            已选 {{ checkedRowKeys.length }} 条
          </n-tag>
          <n-button size="small" class="toolbar-button" :loading="syncLoading" @click="refreshAccounts(false)">
            检测选中
          </n-button>
          <n-button size="small" class="toolbar-button" :loading="syncLoading" @click="refreshAccounts(true)">
            检测全部
          </n-button>
          <n-button size="small" class="toolbar-button" @click="selectAll">全选</n-button>
          <n-button size="small" class="toolbar-button" @click="selectInverse">反选</n-button>
          <n-button
            size="small"
            class="toolbar-button"
            type="error"
            :loading="batchDeleteLoading"
            :disabled="checkedRowKeys.length === 0"
            @click="batchDeleteAccounts"
          >
            批量删除
          </n-button>
          <n-button size="small" class="toolbar-button" :loading="tableLoading" @click="loadAccounts">刷新列表</n-button>
          <n-button size="small" class="toolbar-button" type="primary" secondary @click="openCreateModal">
            新增账户
          </n-button>
          <n-button size="small" class="toolbar-button" type="primary" @click="openImportModal">批量导入</n-button>
        </div>
      </div>

      <n-data-table
        class="account-table account-table-modern"
        size="small"
        :columns="accountColumns"
        :data="pagedAccounts"
        :row-key="rowKey"
        :loading="tableLoading"
        :checked-row-keys="checkedRowKeys"
        :pagination="false"
        max-height="620"
        @update:checked-row-keys="handleCheckedRowKeysUpdate"
      />

      <div class="list-footer">
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
    </n-card>

    <n-modal v-model:show="createVisible" preset="card" class="console-modal" title="新增账户">
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
          <n-button @click="createVisible = false">取消</n-button>
          <n-button type="primary" :loading="createLoading" @click="createAccount">保存账户</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="importVisible" preset="card" class="console-modal" title="批量导入">
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
            <n-button secondary :loading="importLoading" @click="triggerTxtImport">导入 TXT</n-button>
            <n-button type="primary" :loading="importLoading" @click="handleImportText">
              导入文本
            </n-button>
          </n-space>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="editVisible" preset="card" class="console-modal" title="编辑账户">
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
          <n-button @click="editVisible = false">取消</n-button>
          <n-button type="primary" :loading="editLoading" @click="updateAccount">保存修改</n-button>
        </n-space>
      </template>
    </n-modal>

    <MailInboxViewer
      :show="mailVisible"
      title="邮箱邮件"
      subtitle="合并展示收件箱与垃圾邮件"
      :account="mailAccount"
      :items="mailItems"
      :loading="mailLoading"
      :selected-mail-id="selectedMailId"
      :format-date="formatMailDate"
      :show-junk-badge="true"
      @update:show="handleMailVisibleChange"
      @select="selectMail"
      @copy="copyMailAccount"
      @refresh="refreshMailInbox"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
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

const admin = useAdminConsole();
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
  mailVisible,
  mailLoading,
  mailAccount,
  mailItems,
  selectedMailId,
  createForm,
  editForm,
  importText,
  loadAccounts,
  loadInitialData,
  openCreateModal,
  openImportModal,
  openEditModal,
  handleCheckedRowKeysUpdate,
  createAccount,
  updateAccount,
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
  resolveTokenStatusLabel,
  resolveTokenStatusTone,
  resolveCountdownLabel,
  resolveCountdownTone,
  formatMailDate,
  isAuthenticated,
  initialDataLoaded
} = admin;

const txtFileInputRef = ref<HTMLInputElement | null>(null);
const tablePage = ref(1);

const rowKey = (row: AccountItem): number => row.id;

const pageCount = computed(() => Math.max(1, Math.ceil(accounts.value.length / tablePageSize.value)));
const pageOffset = computed(() => (tablePage.value - 1) * tablePageSize.value);
const pagedAccounts = computed(() => {
  const start = pageOffset.value;
  return accounts.value.slice(start, start + tablePageSize.value);
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
  tablePage.value = 1;
  void loadAccounts();
}

function truncateMiddle(value: string | null | undefined, start = 12, end = 8): string {
  const text = (value ?? '').trim();
  if (!text) {
    return '-';
  }
  if (text.length <= start + end + 3) {
    return text;
  }
  return `${text.slice(0, start)}...${text.slice(-end)}`;
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

function renderCodeChip(value: string | null | undefined): ReturnType<typeof h> {
  const text = (value ?? '').trim();
  if (!text) {
    return h('span', { class: 'code-chip code-chip-empty' }, '-');
  }

  return h(
    'span',
    {
      class: 'code-chip',
      title: text
    },
    truncateMiddle(text, 8, 5)
  );
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
    title: '密码',
    key: 'password',
    width: 92,
    render: (row) =>
      h('span', { class: 'plain-cell-text plain-cell-text-compact', title: row.password }, row.password)
  },
  {
    title: 'Client ID',
    key: 'clientId',
    width: 150,
    render: (row) => renderCodeChip(row.clientId)
  },
  {
    title: 'Refresh Token',
    key: 'refreshToken',
    width: 166,
    render: (row) => renderCodeChip(row.refreshToken)
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
    title: '倒计时',
    key: 'tokenCountdownDays',
    width: 88,
    render: (row) =>
      h(
        'span',
        {
          class: ['status-pill', resolveToneClass(resolveCountdownTone(row))],
          title: row.tokenBaseAt ?? resolveCountdownLabel(row)
        },
        resolveCountdownLabel(row)
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
}

function handleMailVisibleChange(value: boolean): void {
  mailVisible.value = value;
}

onMounted(async () => {
  if (!initialDataLoaded.value && isAuthenticated.value) {
    await loadInitialData();
  }
});
</script>
