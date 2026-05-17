<template>
  <div class="page-container sub2api-page">
    <n-card
      class="main-card"
      :bordered="false"
      content-style="padding: 24px; display: flex; flex-direction: column; gap: 20px;"
    >
      <div class="toolbar">
        <span class="tag-pill blue">外部 CLI: uv</span>
        <div class="run-picker">
          <span class="run-picker-label">命令</span>
          <n-select
            v-model:value="runForm.command"
            class="run-command-select"
            size="small"
            :options="commandOptions"
            :disabled="runLoading"
          />
        </div>
        <n-input-number
          v-if="runForm.command === 'all'"
          v-model:value="runForm.count"
          class="run-number-input"
          size="small"
          :min="1"
          :max="100"
          :disabled="runLoading"
          placeholder="数量"
        />
        <n-input-number
          v-if="runForm.command === 'all'"
          v-model:value="runForm.workers"
          class="run-number-input"
          size="small"
          :min="1"
          :max="20"
          :disabled="runLoading"
          placeholder="并发"
        />
        <n-input
          v-if="runForm.command === 'login'"
          v-model:value="runForm.phone"
          class="run-login-input"
          size="small"
          :disabled="runLoading"
          placeholder="手机号，可留空改用 latest"
          :input-props="plainInputProps"
        />
        <n-input
          v-if="runForm.command === 'login'"
          v-model:value="runForm.password"
          class="run-login-input codex-secret-input"
          :class="{ 'is-secret-visible': passwordVisible }"
          type="text"
          size="small"
          :disabled="runLoading"
          placeholder="密码"
          :input-props="secretInputProps('codex-login-password')"
        >
          <template #suffix>
            <button
              type="button"
              class="sub2api-input-icon-button"
              :title="passwordVisible ? '隐藏密码' : '显示密码'"
              :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
              @mousedown.prevent
              @click="passwordVisible = !passwordVisible"
            >
              <svg v-if="passwordVisible" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 3l14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                <path d="M7.4 5.9A7.9 7.9 0 0 1 10 5.5c5.1 0 7.5 4.5 7.5 4.5a11.4 11.4 0 0 1-2.1 2.6M12.1 13.8a7.9 7.9 0 0 1-2.1.3C4.9 14.1 2.5 10 2.5 10a10.9 10.9 0 0 1 2.4-2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg v-else viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M2.5 10s2.4-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.4 4.5-7.5 4.5S2.5 10 2.5 10Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" stroke="currentColor" stroke-width="1.5" />
              </svg>
            </button>
          </template>
        </n-input>
        <n-input-number
          v-if="runForm.command === 'login'"
          v-model:value="runForm.latest"
          class="run-number-input"
          size="small"
          :min="1"
          :max="1000"
          :disabled="runLoading || Boolean(runForm.phone || runForm.password)"
          placeholder="latest"
        />
        <n-checkbox v-if="runForm.command === 'login'" v-model:checked="runForm.force" :disabled="runLoading">
          force
        </n-checkbox>

        <button class="btn btn-default" type="button" @click="showConfigModal = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          配置信息
        </button>

        <button class="btn btn-success" type="button" :disabled="runLoading || !hasConfiguredCodexLogin" @click="startRun">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          {{ runLoading ? '运行中...' : '开始运行' }}
        </button>
        <button v-if="runLoading" class="btn btn-danger-ghost" type="button" @click="stopRun">停止</button>
        <button class="btn btn-default" type="button" :disabled="logs.length === 0" @click="clearLogs">清空日志</button>
      </div>

      <div class="stats-grid">
        <div v-for="item in summaryCards" :key="item.key" class="stat-card" :class="`c-${item.tone}`">
          <div class="stat-title">{{ item.label }}</div>
          <div class="stat-value">{{ item.value }}</div>
        </div>
      </div>

      <div class="log-section">
        <div class="log-section-header">
          <div>
            <span class="log-title">Codex Login 日志</span>
            <span class="log-desc">
              阶段 {{ progress.currentStage || '待运行' }}，进度 {{ progress.processed }} / {{ progress.total }}。敏感信息会在后端脱敏。
            </span>
          </div>
          <span class="run-status" :class="runLoading ? 'is-running' : 'is-idle'">
            {{ runLoading ? '运行中' : '待运行' }}
          </span>
        </div>

        <div ref="logTerminalRef" class="log-terminal">
          <div v-if="logs.length === 0" class="log-empty">运行开始后，日志会实时输出在这里。</div>
          <div v-for="item in logs" :key="item.id" class="log-line">
            <span class="log-time">{{ formatLogTime(item.timestamp) }}</span>
            <span class="log-badge" :class="resolveLevelBadgeTone(item.level)">{{ resolveLevelLabel(item.level) }}</span>
            <span class="log-stream">{{ item.stream }}</span>
            <span class="log-message">{{ item.message }}</span>
          </div>
        </div>
      </div>
    </n-card>

    <n-modal v-model:show="showConfigModal" preset="card" title="Codex Login 配置" style="width: min(900px, 94vw); border-radius: 12px;">
      <p class="config-modal-desc">配置会保存到本项目后端，并在运行前写入外部 CLI 的 config.json。密钥和密码仅在后端使用，日志输出会自动脱敏。</p>
      <n-form label-placement="top" autocomplete="off" class="config-modal-form">
        <div class="form-autofill-guard" aria-hidden="true"><input type="text" tabindex="-1" autocomplete="off" /></div>
        <n-tabs type="line" animated>
          <n-tab-pane name="project" tab="项目">
            <div class="form-grid one">
              <n-form-item label="外部项目路径"><n-input v-model:value="configForm.projectPath" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="Auth Base URL"><n-input v-model:value="configForm.authBaseUrl" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="Chat Base URL"><n-input v-model:value="configForm.chatBaseUrl" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="Chat Web Client ID"><n-input v-model:value="configForm.chatWebClientId" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="Codex Client ID"><n-input v-model:value="configForm.codexClientId" :input-props="plainInputProps" /></n-form-item>
            </div>
          </n-tab-pane>
          <n-tab-pane name="mail" tab="邮箱">
            <div class="form-grid">
              <n-form-item label="邮箱 Provider"><n-select v-model:value="configForm.mailProvider" :options="mailProviderOptions" /></n-form-item>
              <n-form-item label="邮箱域名"><n-input v-model:value="configForm.mailDomain" placeholder="example.com" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="用户名长度"><n-input-number v-model:value="configForm.emailUsernameLength" :min="4" :max="64" /></n-form-item>
              <n-form-item label="邮件轮询间隔（秒）"><n-input-number v-model:value="configForm.mailPollIntervalSeconds" :min="0.2" :max="60" /></n-form-item>
              <n-form-item label="SkyMail Base URL"><n-input v-model:value="configForm.skymailBaseUrl" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="SkyMail 管理员邮箱"><n-input v-model:value="configForm.skymailAdminEmail" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="SkyMail 管理员密码"><secret-input v-model:value="configForm.skymailAdminPassword" name="skymail-admin-password" /></n-form-item>
              <n-form-item label="GPTMail Base URL"><n-input v-model:value="configForm.gptmailBaseUrl" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="GPTMail API Key"><secret-input v-model:value="configForm.gptmailApiKey" name="gptmail-api-key" /></n-form-item>
              <n-form-item label="GPTMail Domain"><n-input v-model:value="configForm.gptmailDomain" :input-props="plainInputProps" /></n-form-item>
            </div>
          </n-tab-pane>
          <n-tab-pane name="sms" tab="短信">
            <div class="form-grid">
              <n-form-item label="短信 Provider"><n-select v-model:value="configForm.smsProvider" :options="smsProviderOptions" /></n-form-item>
              <n-form-item label="HeroSMS API Key"><secret-input v-model:value="configForm.heroSmsApiKey" name="herosms-api-key" /></n-form-item>
              <n-form-item label="5sim API Key"><secret-input v-model:value="configForm.fiveSimApiKey" name="fivesim-api-key" /></n-form-item>
              <n-form-item label="5sim Product"><n-input v-model:value="configForm.fiveSimProduct" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="5sim Operator"><n-input v-model:value="configForm.fiveSimOperator" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="Service"><n-input v-model:value="configForm.smsService" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="Country"><n-input v-model:value="configForm.smsCountry" placeholder="留空自动选择" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="最低价格"><n-input-number v-model:value="configForm.smsMinPrice" :min="0" :max="1000" /></n-form-item>
              <n-form-item label="最高价格"><n-input-number v-model:value="configForm.smsMaxPrice" :min="0" :max="1000" /></n-form-item>
              <n-form-item label="屏蔽国家"><n-dynamic-tags v-model:value="configForm.blockedCountries" /></n-form-item>
            </div>
          </n-tab-pane>
          <n-tab-pane name="advanced" tab="高级">
            <div class="form-grid">
              <n-form-item label="Proxy URL"><secret-input v-model:value="configForm.proxyUrl" name="codex-proxy-url" placeholder="留空表示直连" /></n-form-item>
              <n-form-item label="密码随机长度"><n-input-number v-model:value="configForm.passwordRandomLength" :min="8" :max="128" /></n-form-item>
              <n-form-item label="密码后缀"><secret-input v-model:value="configForm.passwordSuffix" name="password-suffix" /></n-form-item>
              <n-form-item label="密码字符集"><n-input v-model:value="configForm.passwordCharset" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="最大验证码尝试"><n-input-number v-model:value="configForm.maxCaptchaAttempts" :min="1" :max="50" /></n-form-item>
              <n-form-item label="Sentinel Headless"><n-switch v-model:value="configForm.sentinelHeadless" /></n-form-item>
              <n-form-item label="Sentinel Wait 秒"><n-input-number v-model:value="configForm.sentinelWaitSeconds" :min="0" :max="600" /></n-form-item>
              <n-form-item label="CF Extra 秒"><n-input-number v-model:value="configForm.sentinelCfExtraSeconds" :min="0" :max="600" /></n-form-item>
              <n-form-item label="Sentinel Channel"><n-input v-model:value="configForm.sentinelChannel" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="Persistent Profile"><n-switch v-model:value="configForm.sentinelPersistentProfile" /></n-form-item>
              <n-form-item label="Headed Fallback"><n-switch v-model:value="configForm.sentinelHeadedFallback" /></n-form-item>
              <n-form-item label="Profile Dir"><n-input v-model:value="configForm.sentinelProfileDir" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="请求超时秒"><n-input-number v-model:value="configForm.requestTimeoutSeconds" :min="1" :max="3600" /></n-form-item>
              <n-form-item label="邮件超时秒"><n-input-number v-model:value="configForm.emailPollSeconds" :min="1" :max="3600" /></n-form-item>
              <n-form-item label="轮询间隔秒"><n-input-number v-model:value="configForm.pollIntervalSeconds" :min="0.2" :max="300" /></n-form-item>
              <n-form-item label="Token Cache TTL"><n-input-number v-model:value="configForm.tokenCacheTtlSeconds" :min="0" :max="86400" /></n-form-item>
              <n-form-item label="User Agent"><n-input v-model:value="configForm.userAgentChrome" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" :input-props="plainInputProps" /></n-form-item>
              <n-form-item label="Accept Language"><n-input v-model:value="configForm.acceptLanguage" :input-props="plainInputProps" /></n-form-item>
            </div>
          </n-tab-pane>
        </n-tabs>
      </n-form>
      <template #footer>
        <div class="config-modal-footer">
          <n-button @click="showConfigModal = false">取消</n-button>
          <n-button type="primary" :loading="configSaving" @click="handleSaveConfig">保存配置</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  NButton,
  NCard,
  NCheckbox,
  NDynamicTags,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSwitch,
  NTabPane,
  NTabs
} from 'naive-ui';
import { useSub2ApiCodexLogin } from '../state/sub2api-codex-login';
import type { CodexLoginCommand, CodexLoginLogLevel } from '../types';
import { formatTimeBeijing } from '../utils/datetime';

const codex = useSub2ApiCodexLogin();
const {
  initialDataLoaded,
  configSaving,
  runLoading,
  configForm,
  runForm,
  summary,
  progress,
  logs,
  hasConfiguredCodexLogin,
  loadInitialData,
  saveConfig,
  clearLogs,
  startRun,
  stopRun
} = codex;

const showConfigModal = ref(false);
const passwordVisible = ref(false);
const logTerminalRef = ref<HTMLElement | null>(null);

const commandOptions: Array<{ label: string; value: CodexLoginCommand }> = [
  { label: '注册 + Codex 登录', value: 'all' },
  { label: '仅注册', value: 'register' },
  { label: '仅 Codex 登录', value: 'login' }
];
const mailProviderOptions = [
  { label: 'SkyMail', value: 'skymail' },
  { label: 'GPTMail', value: 'gptmail' }
];
const smsProviderOptions = [
  { label: 'HeroSMS', value: 'herosms' },
  { label: '5sim', value: 'fivesim' }
];

const plainInputProps = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
} as const;

function secretInputProps(name: string) {
  return {
    ...plainInputProps,
    name,
    inputmode: 'text',
    'data-form-type': 'other'
  } as const;
}

const secretVisibility = ref<Record<string, boolean>>({});

const SecretInput = defineComponent({
  name: 'SecretInput',
  props: {
    value: { type: String, default: '' },
    name: { type: String, required: true },
    placeholder: { type: String, default: '' }
  },
  emits: ['update:value'],
  setup(props, { emit }) {
    const visible = computed(() => secretVisibility.value[props.name] === true);

    return () => h(
      NInput,
      {
        value: props.value,
        type: 'text',
        placeholder: props.placeholder,
        class: ['codex-secret-input', { 'is-secret-visible': visible.value }],
        inputProps: secretInputProps(props.name),
        'onUpdate:value': (value: string) => emit('update:value', value)
      },
      {
        suffix: () => h(
          'button',
          {
            type: 'button',
            class: 'sub2api-input-icon-button',
            title: visible.value ? '隐藏' : '显示',
            'aria-label': visible.value ? '隐藏' : '显示',
            onMousedown: (event: MouseEvent) => event.preventDefault(),
            onClick: () => {
              secretVisibility.value = {
                ...secretVisibility.value,
                [props.name]: !visible.value
              };
            }
          },
          [h('span', { class: 'eye-dot', 'aria-hidden': 'true' }, visible.value ? '●' : '○')]
        )
      }
    );
  }
});

const summaryCards = computed(() => {
  return [
    { key: 'status', label: '当前状态', value: runLoading.value ? '运行中' : '待运行', tone: runLoading.value ? 'yellow' : 'gray' },
    { key: 'command', label: '命令', value: resolveCommandLabel(summary.command ?? runForm.command), tone: 'blue' },
    { key: 'registered', label: '注册成功', value: summary.registered, tone: 'green' },
    { key: 'loginSucceeded', label: '登录成功', value: summary.loginSucceeded, tone: 'green' },
    { key: 'failed', label: '失败数', value: summary.failed, tone: 'red' },
    { key: 'savedFiles', label: '保存文件', value: summary.savedFiles, tone: 'purple' },
    { key: 'exitCode', label: '退出码', value: summary.exitCode ?? '-', tone: summary.exitCode === 0 ? 'green' : 'gray' },
    { key: 'duration', label: '运行时长', value: formatDuration(), tone: 'blue' }
  ];
});

function resolveCommandLabel(command: CodexLoginCommand): string {
  return commandOptions.find((item) => item.value === command)?.label ?? command;
}

function formatDuration(): string {
  if (!summary.startedAt) {
    return '-';
  }
  const end = summary.finishedAt ? Date.parse(summary.finishedAt) : Date.now();
  const start = Date.parse(summary.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return '-';
  }
  return `${Math.max(0, Math.round((end - start) / 1000))}s`;
}

function formatLogTime(value: string): string {
  return formatTimeBeijing(value);
}

function resolveLevelLabel(level: CodexLoginLogLevel): string {
  if (level === 'success') {
    return 'OK';
  }
  if (level === 'error') {
    return 'ERR';
  }
  if (level === 'warning') {
    return 'WARN';
  }
  return 'INFO';
}

function resolveLevelBadgeTone(level: CodexLoginLogLevel): 'ok' | 'warn' | 'info' {
  if (level === 'success') {
    return 'ok';
  }
  if (level === 'warning' || level === 'error') {
    return 'warn';
  }
  return 'info';
}

async function handleSaveConfig(): Promise<void> {
  await saveConfig();
}

async function scrollTerminalToBottom(): Promise<void> {
  await nextTick();
  const element = logTerminalRef.value;
  if (!element) {
    return;
  }
  element.scrollTop = element.scrollHeight;
}

watch(
  () => logs.value.length,
  () => {
    void scrollTerminalToBottom();
  }
);

onMounted(async () => {
  if (!initialDataLoaded.value) {
    await loadInitialData();
  }
});

onBeforeUnmount(() => {
  stopRun();
});
</script>

<style scoped>
.page-container {
  padding: 24px;
  background-color: #f4f6f8;
  min-height: 100%;
}

.main-card {
  border-radius: 12px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.03);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 20px;
  border-bottom: 1px solid #f1f5f9;
  flex-wrap: wrap;
}

.tag-pill {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
}

.tag-pill.blue {
  background-color: #ecf5ff;
  color: #409eff;
  border-color: #d9ebff;
}

.run-picker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 3px 4px 3px 10px;
  border: 1px solid #dcfce7;
  border-radius: 8px;
  background: #f0fdf4;
}

.run-picker-label {
  font-size: 12px;
  font-weight: 600;
  color: #16a34a;
  white-space: nowrap;
}

.run-command-select {
  width: 170px;
}

.run-number-input {
  width: 110px;
}

.run-login-input {
  width: 220px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
  background: #fff;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn svg {
  width: 16px;
  height: 16px;
}

.btn:disabled {
  opacity: 0.56;
  cursor: not-allowed;
}

.btn-default {
  border-color: #e2e8f0;
  color: #1e293b;
}

.btn-default:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
}

.btn-success {
  background: #10b981;
  color: #fff;
}

.btn-success:hover:not(:disabled) {
  background: #059669;
}

.btn-danger-ghost {
  background: transparent;
  color: #f56c6c;
  border-color: #f56c6c;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 12px;
}

.stat-card {
  background-color: #ffffff;
  border: 1px solid #f1f5f9;
  border-radius: 6px;
  padding: 12px 14px;
  position: relative;
  overflow: hidden;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
}

.stat-card.c-gray::before { background-color: #cbd5e1; }
.stat-card.c-green::before { background-color: #10b981; }
.stat-card.c-blue::before { background-color: #3b82f6; }
.stat-card.c-purple::before { background-color: #8b5cf6; }
.stat-card.c-yellow::before { background-color: #f59e0b; }
.stat-card.c-red::before { background-color: #ef4444; }

.stat-title {
  font-size: 12px;
  color: #475569;
  margin-bottom: 4px;
  font-weight: 500;
  white-space: nowrap;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}

.log-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.log-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}

.log-desc {
  font-size: 13px;
  color: #94a3b8;
  margin-left: 12px;
}

.run-status {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.run-status.is-running {
  background: #fef3c7;
  color: #b45309;
}

.run-status.is-idle {
  background: #e2e8f0;
  color: #475569;
}

.log-terminal {
  background-color: #0f172a;
  border-radius: 8px;
  padding: 16px;
  height: 440px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #e2e8f0;
}

.log-empty {
  color: #94a3b8;
}

.log-line {
  margin-bottom: 6px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.log-time,
.log-stream {
  color: #64748b;
  flex-shrink: 0;
}

.log-stream {
  width: 54px;
  text-transform: uppercase;
  font-size: 11px;
}

.log-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  flex-shrink: 0;
  width: 44px;
  text-align: center;
}

.log-badge.warn {
  background-color: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.log-badge.info {
  background-color: rgba(56, 130, 246, 0.2);
  color: #60a5fa;
}

.log-badge.ok {
  background-color: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.log-message {
  color: #cbd5e1;
  word-break: break-all;
}

.config-modal-desc {
  font-size: 13px;
  color: #94a3b8;
  margin: 0 0 16px;
}

.config-modal-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.form-grid.one {
  grid-template-columns: 1fr;
}

.config-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

:deep(.codex-secret-input:not(.is-secret-visible) .n-input__input-el) {
  -webkit-text-security: disc;
  text-security: disc;
}

.sub2api-input-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
  transition: color 0.18s ease, background-color 0.18s ease;
}

.sub2api-input-icon-button:hover {
  color: #475569;
  background: #f1f5f9;
}

.eye-dot {
  font-size: 12px;
  line-height: 1;
}

.form-autofill-guard {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

@media (max-width: 1100px) {
  .stats-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 720px) {
  .stats-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .run-picker,
  .run-command-select,
  .run-number-input,
  .run-login-input {
    width: 100%;
  }

  .log-section-header,
  .log-line {
    flex-wrap: wrap;
  }
}
</style>
