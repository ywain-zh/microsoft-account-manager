<template>
  <div class="page-container linuxdo-mail-page">
    <n-card
      class="main-card linuxdo-mail-card"
      :bordered="false"
      content-style="padding: 0; display: flex; flex-direction: column;"
    >
      <div class="gmail-workspace">
        <aside class="gmail-folder-rail">
          <div class="gmail-account-chip">
            <div class="gmail-account-main">
              <span class="gmail-account-dot" aria-hidden="true"></span>
              <div class="gmail-account-copy">
                <strong>{{ configForm.email || 'Linux DO Mail' }}</strong>
                <small>{{ configStatusText }}</small>
              </div>
            </div>
          </div>

          <div class="gmail-rail-action-card">
            <button
              class="gmail-rail-compose-button"
              type="button"
              :disabled="!isConfigured"
              @click="openCompose"
            >
              <span aria-hidden="true">
                <SendGlyph />
              </span>
              <strong>写邮件</strong>
            </button>

            <button
              class="gmail-folder-link"
              :class="{ active: activeFolder === 'inbox' }"
              type="button"
              @click="setActiveFolder('inbox')"
            >
              <span class="gmail-folder-icon" aria-hidden="true">
                <InboxGlyph />
              </span>
              <span>收件箱</span>
              <strong>{{ mailItems.length }}</strong>
            </button>

            <button
              class="gmail-folder-link"
              :class="{ active: activeFolder === 'sent' }"
              type="button"
              @click="setActiveFolder('sent')"
            >
              <span class="gmail-folder-icon" aria-hidden="true">
                <SentFolderGlyph />
              </span>
              <span>发件箱</span>
              <strong>{{ sentItems.length }}</strong>
            </button>
          </div>
        </aside>

        <section class="gmail-mail-panel">
          <header class="gmail-topbar">
            <div class="gmail-search-shell">
              <span aria-hidden="true">
                <SearchGlyph />
              </span>
              <div>
                <strong>{{ activeFolderTitle }}</strong>
                <small>{{ activeFolderSubtitle }}</small>
              </div>
            </div>

            <div class="gmail-topbar-actions">
              <button
                class="gmail-icon-button"
                type="button"
                title="刷新收件箱"
                aria-label="刷新收件箱"
                :disabled="!isConfigured || mailLoading"
                @click="refreshMessages()"
              >
                <RefreshGlyph />
              </button>
              <button
                class="gmail-icon-button"
                type="button"
                title="配置邮箱"
                aria-label="配置邮箱"
                @click="openConfig"
              >
                <GearGlyph />
              </button>
            </div>
          </header>

          <n-alert v-if="mailError" type="error" :bordered="false" class="mailbox-alert">
            {{ mailError }}
          </n-alert>

          <div class="gmail-list-head">
            <span>{{ activeFolderTitle }}</span>
            <strong>{{ activeFolderCount }} 封</strong>
          </div>

          <div v-if="activeFolder === 'inbox'" class="gmail-message-list">
            <div v-if="!isConfigured" class="gmail-empty-state">
              <strong>尚未配置 Linux DO 邮箱</strong>
              <p>点击右上角配置邮箱后，就可以查看收件箱。</p>
              <n-button type="primary" @click="openConfig">配置邮箱</n-button>
            </div>
            <div v-else-if="mailLoading && mailItems.length === 0" class="gmail-empty-state">
              <strong>正在刷新收件箱</strong>
              <p>正在连接 Linux DO 邮箱服务器。</p>
            </div>
            <div v-else-if="mailItems.length === 0" class="gmail-empty-state">
              <strong>收件箱为空</strong>
              <p>刷新后仍没有邮件。</p>
              <n-button :loading="mailLoading" @click="refreshMessages()">刷新收件箱</n-button>
            </div>
            <template v-else>
              <button
                v-for="item in mailItems"
                :key="item.id"
                class="gmail-message-row"
                :class="{ unread: item.isRead === false }"
                type="button"
                @click="openMailFromList(item.id)"
              >
                <span class="gmail-row-check" aria-hidden="true"></span>
                <span class="gmail-row-from" :title="item.from || '未知发件人'">{{ item.from || '未知发件人' }}</span>
                <span class="gmail-row-content">
                  <strong>{{ item.subject || '(无主题)' }}</strong>
                  <small>{{ resolveMessagePreview(item) || '暂无邮件摘要' }}</small>
                </span>
                <span class="gmail-row-date">{{ formatDate(item.receivedAt) }}</span>
              </button>
            </template>
          </div>

          <div v-else class="gmail-message-list">
            <div v-if="sentItems.length === 0" class="gmail-empty-state">
              <strong>发件箱为空</strong>
              <p>发送成功的邮件会暂时显示在这里。</p>
              <n-button type="primary" :disabled="!isConfigured" @click="openCompose">写邮件</n-button>
            </div>
            <template v-else>
              <div
                v-for="item in sentItems"
                :key="item.id"
                class="gmail-message-row gmail-message-row-static"
              >
                <span class="gmail-row-check" aria-hidden="true"></span>
                <span class="gmail-row-from" :title="item.to">{{ item.to }}</span>
                <span class="gmail-row-content">
                  <strong>{{ item.subject || '(无主题)' }}</strong>
                  <small>{{ item.preview || '已发送' }}</small>
                </span>
                <span class="gmail-row-date">{{ formatDate(item.sentAt) }}</span>
              </div>
            </template>
          </div>
        </section>
      </div>
    </n-card>

    <n-modal
      v-model:show="configVisible"
      preset="card"
      :bordered="false"
      class="console-modal linuxdo-config-modal"
      title="Linux DO 邮箱配置"
      @after-leave="clearConfigSecret"
    >
      <n-form label-placement="top" autocomplete="off" class="linuxdo-config-form">
        <div class="form-autofill-guard" aria-hidden="true">
          <input type="text" tabindex="-1" autocomplete="username" />
          <input type="password" tabindex="-1" autocomplete="new-password" />
        </div>

        <n-grid :cols="24" :x-gap="14" :y-gap="2">
          <n-gi :span="24" :m="12">
            <n-form-item label="邮箱账号">
              <n-input
                v-model:value="configForm.email"
                placeholder="name@linux.do"
                :input-props="emailInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :m="12">
            <n-form-item label="显示名称">
              <n-input
                v-model:value="configForm.displayName"
                placeholder="发件显示名称"
                :input-props="displayNameInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :m="12">
            <n-form-item label="IMAP 服务器">
              <n-input
                v-model:value="configForm.imapHost"
                placeholder="mail.linux.do"
                :input-props="hostInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :m="12">
            <n-form-item label="IMAP 端口">
              <n-input-number v-model:value="configForm.imapPort" :min="1" :max="65535" class="port-input" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :m="12">
            <n-form-item label="SMTP 服务器">
              <n-input
                v-model:value="configForm.smtpHost"
                placeholder="mail.linux.do"
                :input-props="hostInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :m="12">
            <n-form-item label="SMTP 端口">
              <n-input-number v-model:value="configForm.smtpPort" :min="1" :max="65535" class="port-input" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24">
            <n-form-item label="授权令牌">
              <SecretInput
                v-model:value="configForm.authToken"
                :placeholder="configForm.tokenConfigured ? '留空保留当前令牌' : '请输入 Linux DO 邮箱授权令牌'"
                :input-props="tokenInputProps"
              />
            </n-form-item>
          </n-gi>
          <n-gi :span="24">
            <n-form-item label="连接代理">
              <div class="linuxdo-proxy-option">
                <div>
                  <strong>启用系统代理</strong>
                  <span>使用系统设置里的代理连接 IMAP 和 SMTP</span>
                </div>
                <n-switch v-model:value="configForm.useSystemProxy" />
              </div>
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>

      <div v-if="connectionResult" class="connection-result">
        <div class="connection-row is-info">
          <span>连接方式</span>
          <strong>{{ connectionModeText }}</strong>
        </div>
        <div class="connection-row" :class="connectionResult.imap.ok ? 'is-ok' : 'is-error'">
          <span>IMAP</span>
          <strong>{{ connectionResult.imap.message }}</strong>
        </div>
        <div class="connection-row" :class="connectionResult.smtp.ok ? 'is-ok' : 'is-error'">
          <span>SMTP</span>
          <strong>{{ connectionResult.smtp.message }}</strong>
        </div>
      </div>

      <template #footer>
        <n-space justify="space-between">
          <n-button :loading="configLoading" @click="loadConfig">重新载入</n-button>
          <n-space>
            <n-button :loading="testing" :disabled="!canTestConnection" @click="testConnection">测试连接</n-button>
            <n-button class="dialog-cancel-button" @click="configVisible = false">取消</n-button>
            <n-button type="primary" class="dialog-primary-button" :loading="configSaving" @click="saveConfig">
              保存配置
            </n-button>
          </n-space>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="composeVisible"
      preset="card"
      :bordered="false"
      class="console-modal linuxdo-compose-modal"
      title="写邮件"
      @after-leave="resetCompose"
    >
      <n-form label-placement="top" autocomplete="off" class="compose-form">
        <n-form-item label="收件人">
          <n-input v-model:value="composeForm.to" placeholder="user@example.com" :input-props="recipientInputProps" />
        </n-form-item>
        <n-grid :cols="24" :x-gap="14">
          <n-gi :span="24" :m="12">
            <n-form-item label="抄送">
              <n-input v-model:value="composeForm.cc" placeholder="可留空" :input-props="recipientInputProps" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24" :m="12">
            <n-form-item label="密送">
              <n-input v-model:value="composeForm.bcc" placeholder="可留空" :input-props="recipientInputProps" />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-form-item label="主题">
          <n-input v-model:value="composeForm.subject" placeholder="邮件主题" :input-props="subjectInputProps" />
        </n-form-item>
        <div class="compose-mode-row">
          <n-radio-group v-model:value="composeMode" size="small">
            <n-radio-button value="text">纯文本</n-radio-button>
            <n-radio-button value="html">HTML</n-radio-button>
          </n-radio-group>
        </div>
        <n-form-item :label="composeMode === 'text' ? '正文' : 'HTML 正文'">
          <n-input
            v-if="composeMode === 'text'"
            v-model:value="composeForm.text"
            type="textarea"
            :autosize="{ minRows: 10, maxRows: 18 }"
            placeholder="输入邮件正文"
            :input-props="bodyInputProps"
          />
          <n-input
            v-else
            v-model:value="composeForm.html"
            type="textarea"
            :autosize="{ minRows: 10, maxRows: 18 }"
            placeholder="<p>输入 HTML 正文</p>"
            :input-props="bodyInputProps"
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button class="dialog-cancel-button" @click="composeVisible = false">取消</n-button>
          <n-button type="primary" class="dialog-primary-button" :loading="composeSending" @click="sendMail">
            发送邮件
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <MailInboxViewer
      :show="mailVisible"
      title="Linux DO 收件箱"
      :account="mailAccount"
      :items="mailItems"
      :loading="mailLoading"
      :selected-mail-id="selectedMailId"
      :format-date="formatDate"
      :on-copy="copyMailAccount"
      @update:show="mailVisible = $event"
      @select="selectMail"
      @refresh="refreshMessages"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NGi,
  NGrid,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NSwitch,
  NTag,
  createDiscreteApi
} from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import MailInboxViewer from '../components/MailInboxViewer.vue';
import SecretInput from '../components/SecretInput.vue';
import type {
  AccountMailItem,
  LinuxDoMailConfig,
  LinuxDoMailConnectionTestResponse,
  LinuxDoMailSendPayload
} from '../types';
import { copyToClipboard } from '../utils/clipboard';

const InboxGlyph = () =>
  h('svg', { viewBox: '0 0 20 20', fill: 'none' }, [
    h('path', {
      d: 'M3.75 5.25h12.5v9.5H3.75z',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linejoin': 'round'
    }),
    h('path', {
      d: 'm4.25 6 5.75 4.25L15.75 6',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    })
  ]);

const SendGlyph = () =>
  h('svg', { viewBox: '0 0 20 20', fill: 'none' }, [
    h('path', {
      d: 'M16.25 3.75 8.9 16.25l-1.35-5.8-4.8-2.9 13.5-3.8Z',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linejoin': 'round'
    }),
    h('path', {
      d: 'm7.55 10.45 4.2-3.2',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linecap': 'round'
    })
  ]);

const SentFolderGlyph = () =>
  h('svg', { viewBox: '0 0 20 20', fill: 'none' }, [
    h('path', {
      d: 'M3.75 10 16.25 3.75 10 16.25 8.75 11.25 3.75 10Z',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linejoin': 'round'
    }),
    h('path', {
      d: 'm8.75 11.25 3.25-3',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linecap': 'round'
    })
  ]);

const GearGlyph = () =>
  h('svg', { viewBox: '0 0 20 20', fill: 'none' }, [
    h('path', {
      d: 'M10 12.5A2.5 2.5 0 1 0 10 7.5a2.5 2.5 0 0 0 0 5Z',
      stroke: 'currentColor',
      'stroke-width': '1.7'
    }),
    h('path', {
      d: 'M16.25 10a1.2 1.2 0 0 0-.79-1.13l-.91-.32a4.95 4.95 0 0 0-.37-.9l.4-.87a1.2 1.2 0 0 0-.25-1.36l-.42-.42a1.2 1.2 0 0 0-1.36-.25l-.87.4c-.29-.15-.59-.27-.9-.37l-.32-.91A1.2 1.2 0 0 0 10 3.75h-.6a1.2 1.2 0 0 0-1.13.79l-.32.91c-.31.1-.61.22-.9.37l-.87-.4a1.2 1.2 0 0 0-1.36.25l-.42.42a1.2 1.2 0 0 0-.25 1.36l.4.87c-.15.29-.27.59-.37.9l-.91.32A1.2 1.2 0 0 0 3.75 10v.6c0 .52.33.98.79 1.13l.91.32c.1.31.22.61.37.9l-.4.87a1.2 1.2 0 0 0 .25 1.36l.42.42c.36.36.9.46 1.36.25l.87-.4c.29.15.59.27.9.37l.32.91c.15.46.61.79 1.13.79h.6c.52 0 .98-.33 1.13-.79l.32-.91c.31-.1.61-.22.9-.37l.87.4c.46.21 1 .11 1.36-.25l.42-.42c.36-.36.46-.9.25-1.36l-.4-.87c.15-.29.27-.59.37-.9l.91-.32c.46-.15.79-.61.79-1.13V10Z',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linejoin': 'round'
    })
  ]);

const SearchGlyph = () =>
  h('svg', { viewBox: '0 0 20 20', fill: 'none' }, [
    h('path', {
      d: 'M8.75 14a5.25 5.25 0 1 1 0-10.5 5.25 5.25 0 0 1 0 10.5Z',
      stroke: 'currentColor',
      'stroke-width': '1.6'
    }),
    h('path', {
      d: 'm12.5 12.5 4 4',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linecap': 'round'
    })
  ]);

const RefreshGlyph = () =>
  h('svg', { viewBox: '0 0 20 20', fill: 'none' }, [
    h('path', {
      d: 'M16 10a6 6 0 1 1-1.76-4.24',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }),
    h('path', {
      d: 'M16 5.5v3.5h-3.5',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    })
  ]);

const { message } = createDiscreteApi(['message']);

type LinuxDoMailConfigForm = LinuxDoMailConfig & { authToken: string };
type ActiveFolder = 'inbox' | 'sent';

interface SentMailRecord {
  id: string;
  to: string;
  subject: string;
  preview: string;
  sentAt: string;
}

const configLoading = ref(false);
const configSaving = ref(false);
const testing = ref(false);
const mailLoading = ref(false);
const configVisible = ref(false);
const composeVisible = ref(false);
const composeSending = ref(false);
const composeMode = ref<'text' | 'html'>('text');
const mailVisible = ref(false);
const mailError = ref('');
const lastFetchedAt = ref('');
const connectionResult = ref<LinuxDoMailConnectionTestResponse | null>(null);
const mailAccount = ref('');
const mailItems = ref<AccountMailItem[]>([]);
const sentItems = ref<SentMailRecord[]>([]);
const selectedMailId = ref('');
const activeFolder = ref<ActiveFolder>('inbox');

const configForm = reactive<LinuxDoMailConfigForm>({
  email: '',
  displayName: '',
  imapHost: 'mail.linux.do',
  imapPort: 993,
  smtpHost: 'mail.linux.do',
  smtpPort: 465,
  useSystemProxy: false,
  authToken: '',
  tokenConfigured: false,
  updatedAt: null
});

const composeForm = reactive<LinuxDoMailSendPayload>({
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  text: '',
  html: ''
});

const isConfigured = computed(() => Boolean(configForm.email && configForm.tokenConfigured));
const canTestConnection = computed(() => {
  return Boolean(
    configForm.email.trim() &&
      configForm.imapHost.trim() &&
      configForm.smtpHost.trim() &&
      configForm.imapPort &&
      configForm.smtpPort &&
      (configForm.tokenConfigured || configForm.authToken.trim())
  );
});
const configStatusText = computed(() => {
  if (!configForm.email) {
    return '保存邮箱账号和授权令牌';
  }
  if (!configForm.tokenConfigured) {
    return '授权令牌尚未保存';
  }
  return configForm.updatedAt ? `更新于 ${formatDate(configForm.updatedAt)}` : '连接参数已保存';
});
const activeFolderTitle = computed(() => activeFolder.value === 'inbox' ? '收件箱' : '发件箱');
const activeFolderCount = computed(() => activeFolder.value === 'inbox' ? mailItems.value.length : sentItems.value.length);
const activeFolderSubtitle = computed(() => {
  if (activeFolder.value === 'inbox') {
    return lastFetchedAt.value ? `上次刷新 ${formatDate(lastFetchedAt.value)}` : '最近 30 封收件箱邮件';
  }
  return sentItems.value.length ? '当前页面已发送记录' : '发信成功后会显示在这里';
});
const connectionModeText = computed(() => {
  if (!connectionResult.value?.useSystemProxy) {
    return '直连';
  }
  return connectionResult.value.proxyConfigured ? '系统代理' : '系统代理未配置';
});

const emailInputProps = {
  autocomplete: 'username',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'linuxdo-mail-email'
} as const;

const displayNameInputProps = {
  autocomplete: 'off',
  name: 'linuxdo-mail-display-name'
} as const;

const hostInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'linuxdo-mail-host'
} as const;

const tokenInputProps = {
  autocomplete: 'new-password',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  name: 'linuxdo-mail-auth-token',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

const recipientInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false'
} as const;

const subjectInputProps = {
  autocomplete: 'off',
  name: 'linuxdo-mail-subject'
} as const;

const bodyInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false'
} as const;

onMounted(() => {
  void loadConfig();
});

function openConfig(): void {
  connectionResult.value = null;
  configVisible.value = true;
}

function clearConfigSecret(): void {
  configForm.authToken = '';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误';
}

function handleApiError(error: unknown): void {
  if (error instanceof UnauthorizedError) {
    message.warning('登录已过期，请重新登录');
    if (typeof window !== 'undefined') {
      const redirect = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`);
    }
    return;
  }

  message.error(getErrorMessage(error));
}

function assignConfig(item: LinuxDoMailConfig): void {
  configForm.email = item.email;
  configForm.displayName = item.displayName;
  configForm.imapHost = item.imapHost || 'mail.linux.do';
  configForm.imapPort = item.imapPort || 993;
  configForm.smtpHost = item.smtpHost || 'mail.linux.do';
  configForm.smtpPort = item.smtpPort || 465;
  configForm.useSystemProxy = item.useSystemProxy === true;
  configForm.tokenConfigured = item.tokenConfigured;
  configForm.updatedAt = item.updatedAt;
  configForm.authToken = '';
}

async function loadConfig(): Promise<void> {
  configLoading.value = true;
  try {
    const response = await api.getLinuxDoMailConfig();
    assignConfig(response.item);
    if (response.item.email && response.item.tokenConfigured && mailItems.value.length === 0) {
      void refreshMessages();
    }
  } catch (error) {
    handleApiError(error);
  } finally {
    configLoading.value = false;
  }
}

async function saveConfig(): Promise<void> {
  configSaving.value = true;
  connectionResult.value = null;
  const expectedUseSystemProxy = configForm.useSystemProxy;
  try {
    await api.updateLinuxDoMailConfig({ ...configForm });
    const response = await api.getLinuxDoMailConfig();
    assignConfig(response.item);
    if (response.item.useSystemProxy !== expectedUseSystemProxy) {
      message.error('代理开关没有保存成功，请确认后端已更新后再保存');
      return;
    }
    configVisible.value = false;
    message.success('Linux DO 邮箱配置已保存');
    void refreshMessages();
  } catch (error) {
    handleApiError(error);
  } finally {
    configSaving.value = false;
  }
}

async function testConnection(): Promise<void> {
  testing.value = true;
  connectionResult.value = null;
  try {
    connectionResult.value = await api.testLinuxDoMailConnection({ ...configForm });
    if (connectionResult.value.ok) {
      message.success('Linux DO 邮箱连接可用');
    } else {
      message.warning('连接测试未全部通过');
    }
  } catch (error) {
    handleApiError(error);
  } finally {
    testing.value = false;
  }
}

function setActiveFolder(folder: ActiveFolder): void {
  activeFolder.value = folder;
  if (folder === 'inbox' && isConfigured.value && mailItems.value.length === 0) {
    void refreshMessages();
  }
}

async function refreshMessages(): Promise<void> {
  if (mailLoading.value) {
    return;
  }
  mailLoading.value = true;
  mailError.value = '';
  try {
    const response = await api.getLinuxDoMailMessages(30);
    mailAccount.value = response.account;
    mailItems.value = response.messages;
    selectedMailId.value = response.messages[0]?.id ?? '';
    lastFetchedAt.value = new Date().toISOString();
  } catch (error) {
    mailError.value = getErrorMessage(error);
    handleApiError(error);
  } finally {
    mailLoading.value = false;
  }
}

async function openMailFromList(id: string): Promise<void> {
  selectedMailId.value = id;
  mailVisible.value = true;
  await selectMail(id);
}

async function openInbox(): Promise<void> {
  mailVisible.value = true;
  if (mailItems.value.length === 0) {
    await refreshMessages();
  }
}

async function selectMail(id: string): Promise<void> {
  selectedMailId.value = id;
  const target = mailItems.value.find((item) => item.id === id);
  if (!target || target.isRead === true) {
    return;
  }

  mailItems.value = mailItems.value.map((item) => item.id === id ? { ...item, isRead: true } : item);
  try {
    await api.markLinuxDoMailMessageAsRead(id);
  } catch (error) {
    handleApiError(error);
  }
}

async function copyMailAccount(): Promise<boolean> {
  const copied = await copyToClipboard(mailAccount.value || configForm.email);
  if (copied) {
    message.success('邮箱已复制');
  }
  return copied;
}

function openCompose(): void {
  resetCompose();
  composeVisible.value = true;
}

function resetCompose(): void {
  composeForm.to = '';
  composeForm.cc = '';
  composeForm.bcc = '';
  composeForm.subject = '';
  composeForm.text = '';
  composeForm.html = '';
  composeMode.value = 'text';
}

function resolveMessagePreview(item: AccountMailItem): string {
  const preview = item.preview?.trim();
  if (preview) {
    return preview;
  }

  return item.content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

async function sendMail(): Promise<void> {
  composeSending.value = true;
  try {
    const result = await api.sendLinuxDoMail({
      to: composeForm.to,
      cc: composeForm.cc,
      bcc: composeForm.bcc,
      subject: composeForm.subject,
      text: composeMode.value === 'text' ? composeForm.text : '',
      html: composeMode.value === 'html' ? composeForm.html : ''
    });
    sentItems.value = [
      {
        id: result.messageId || `sent-${Date.now()}`,
        to: composeForm.to,
        subject: composeForm.subject,
        preview: composeMode.value === 'html'
          ? (composeForm.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          : (composeForm.text ?? '').trim(),
        sentAt: new Date().toISOString()
      },
      ...sentItems.value
    ];
    activeFolder.value = 'sent';
    composeVisible.value = false;
    message.success('邮件已发送');
  } catch (error) {
    handleApiError(error);
  } finally {
    composeSending.value = false;
  }
}

function formatDate(value: string | null): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
</script>

<style scoped>
.linuxdo-mail-page {
  min-width: 0;
}

.linuxdo-mail-card {
  overflow: hidden;
  background: #ffffff;
}

.gmail-workspace {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  min-height: 680px;
  background: #f6f8fc;
}

.gmail-folder-rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 8px 18px 0;
  background: #f6f8fc;
  border-right: 1px solid #e5e7eb;
}

.gmail-account-chip {
  display: grid;
  gap: 12px;
  margin: 0 8px 12px;
  padding: 12px;
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 251, 255, 0.96)),
    #ffffff;
  border: 1px solid #dbe5f1;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.05);
}

.gmail-account-main {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.gmail-account-copy {
  min-width: 0;
}

.gmail-account-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #0f9d58;
  box-shadow: 0 0 0 4px rgba(15, 157, 88, 0.12);
  flex: none;
}

.gmail-account-chip strong,
.gmail-account-chip small {
  display: block;
  min-width: 0;
}

.gmail-account-chip strong {
  color: #202124;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gmail-account-chip small {
  margin-top: 2px;
  color: #5f6368;
  font-size: var(--text-xs);
  line-height: 1.35;
}

.gmail-rail-action-card {
  display: grid;
  gap: 6px;
  margin: 0 8px 12px;
  padding: 8px;
  border: 1px solid #dbe5f1;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.04);
}

.gmail-rail-compose-button,
.gmail-folder-link {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  width: 100%;
  box-sizing: border-box;
  padding: 0 14px;
  border-radius: 8px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-align: left;
  cursor: pointer;
}

.gmail-folder-link {
  border: 1px solid transparent;
  background: transparent;
  color: #3c4043;
}

.gmail-rail-compose-button {
  margin: 0;
  border: 1px solid #16a34a;
  background: #16a34a;
  color: #ffffff;
  box-shadow: 0 10px 18px rgba(22, 163, 74, 0.16);
}

.gmail-rail-compose-button:hover:not(:disabled) {
  border-color: #15803d;
  background: #15803d;
  box-shadow: 0 12px 22px rgba(22, 163, 74, 0.22);
}

.gmail-rail-compose-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
  box-shadow: none;
}

.gmail-rail-compose-button > span:first-child,
.gmail-folder-icon {
  display: inline-flex;
  justify-content: center;
  width: 22px;
  color: currentColor;
}

.gmail-rail-compose-button svg {
  width: 17px;
  height: 17px;
}

.gmail-rail-compose-button > strong,
.gmail-folder-link > span:not(.gmail-folder-icon) {
  font-size: var(--text-sm);
  line-height: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gmail-rail-compose-button > strong {
  font-weight: var(--weight-bold);
}

.gmail-folder-link:hover,
.gmail-folder-link.active {
  background: #d3e3fd;
  color: #001d35;
}

.gmail-folder-link strong {
  color: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.gmail-folder-icon svg,
.gmail-icon-button svg,
.gmail-search-shell svg {
  width: 18px;
  height: 18px;
}

.gmail-mail-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background:
    linear-gradient(180deg, #fbfdff 0%, #ffffff 150px),
    #ffffff;
}

.gmail-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 72px;
  padding: 14px 20px;
  border-bottom: 1px solid #e8eaed;
}

.gmail-search-shell {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  width: min(680px, 60%);
  min-height: 44px;
  padding: 0 16px;
  border-radius: 8px;
  background: #edf2fa;
  color: #3c4043;
}

.gmail-search-shell > span {
  display: inline-flex;
  flex: none;
}

.gmail-search-shell strong,
.gmail-search-shell small {
  display: block;
  min-width: 0;
}

.gmail-search-shell strong {
  color: #202124;
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  line-height: 1.25;
}

.gmail-search-shell small {
  margin-top: 2px;
  color: #5f6368;
  font-size: var(--text-xs);
  line-height: 1.3;
}

.gmail-topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.gmail-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #5f6368;
  cursor: pointer;
}

.gmail-icon-button:hover:not(:disabled) {
  background: #f1f3f4;
  color: #202124;
}

.gmail-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.mailbox-alert {
  margin: 14px 20px 0;
  border-radius: 8px;
}

.gmail-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 20px;
  border-bottom: 1px solid #e8eaed;
  color: #5f6368;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
}

.gmail-list-head strong {
  color: #5f6368;
  font-weight: var(--weight-semibold);
}

.gmail-message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.gmail-message-row {
  display: grid;
  grid-template-columns: 22px minmax(120px, 190px) minmax(0, 1fr) 86px;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 40px;
  padding: 0 16px 0 20px;
  border: 0;
  border-bottom: 1px solid #e8eaed;
  background: #f8fbff;
  color: #202124;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.gmail-message-row:hover {
  position: relative;
  z-index: 1;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(60, 64, 67, 0.24);
}

.gmail-message-row.unread {
  background: #ffffff;
  font-weight: var(--weight-bold);
}

.gmail-message-row-static {
  cursor: default;
}

.gmail-message-row-static:hover {
  box-shadow: none;
}

.gmail-row-check {
  width: 14px;
  height: 14px;
  border: 1px solid #bdc1c6;
  border-radius: 2px;
  background: #ffffff;
}

.gmail-row-from,
.gmail-row-content,
.gmail-row-date {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gmail-row-from {
  color: #202124;
  font-size: var(--text-sm);
}

.gmail-row-content {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.gmail-row-content strong {
  min-width: 0;
  color: #202124;
  font-size: var(--text-sm);
  font-weight: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gmail-row-content small {
  min-width: 0;
  color: #5f6368;
  font-size: var(--text-sm);
  font-weight: var(--weight-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gmail-row-content small::before {
  content: '- ';
}

.gmail-row-date {
  color: #5f6368;
  font-size: var(--text-xs);
  text-align: right;
}

.gmail-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  min-height: 360px;
  padding: 40px 24px;
  color: #5f6368;
  text-align: center;
}

.gmail-empty-state strong {
  color: #202124;
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}

.gmail-empty-state p {
  max-width: 360px;
  margin: 0;
  color: #5f6368;
  font-size: var(--text-sm);
  line-height: 1.6;
}

.linuxdo-config-form {
  padding-top: 4px;
}

.port-input {
  width: 100%;
}

.linuxdo-proxy-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-height: 52px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fbff;
}

.linuxdo-proxy-option div {
  min-width: 0;
}

.linuxdo-proxy-option strong,
.linuxdo-proxy-option span {
  display: block;
}

.linuxdo-proxy-option strong {
  color: #202124;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.linuxdo-proxy-option span {
  margin-top: 2px;
  color: #5f6368;
  font-size: var(--text-xs);
  line-height: 1.4;
}

.connection-result {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.connection-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.connection-row span {
  color: #64748b;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
}

.connection-row strong {
  color: #334155;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-align: right;
}

.connection-row.is-ok {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.connection-row.is-ok strong {
  color: #047857;
}

.connection-row.is-info {
  border-color: #dbeafe;
  background: #eff6ff;
}

.connection-row.is-info strong {
  color: #1d4ed8;
}

.connection-row.is-error {
  border-color: #fecaca;
  background: #fef2f2;
}

.connection-row.is-error strong {
  color: #b91c1c;
}

.compose-mode-row {
  display: flex;
  justify-content: flex-end;
  margin: -2px 0 12px;
}

.compose-form {
  padding-top: 4px;
}

@media (max-width: 1024px) {
  .gmail-workspace {
    grid-template-columns: 1fr;
  }

  .gmail-folder-rail {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
    border-right: 0;
  }

  .gmail-account-chip {
    grid-column: 1 / -1;
    margin: 0;
  }

  .gmail-rail-action-card {
    grid-column: 1 / -1;
    margin: 0;
  }

  .gmail-folder-link {
    margin: 0;
    border-radius: 8px;
  }
}

@media (max-width: 640px) {
  .gmail-topbar {
    align-items: stretch;
    flex-direction: column;
  }

  .gmail-search-shell {
    width: 100%;
  }

  .gmail-topbar-actions {
    justify-content: flex-end;
  }

  .gmail-message-row {
    grid-template-columns: 18px minmax(0, 1fr) 68px;
    gap: 10px;
    min-height: 58px;
  }

  .gmail-row-from {
    display: none;
  }

  .gmail-row-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .gmail-row-content small::before {
    content: '';
  }
}
</style>
