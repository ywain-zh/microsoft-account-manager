<template>
  <div class="pokemon-page" :class="{ 'is-embedded': embedded }">
    <section v-if="!embedded" class="renewal-hero">
      <div class="hero-copy">
        <button class="back-link" type="button" @click="router.push('/services/sub2api/public-checkin')">← 返回公益站签到</button>
        <div class="hero-kicker">MONTHLY RENEWAL</div>
        <h2>宝可梦套餐续费</h2>
        <p>一个优惠码，依次处理所有启用账号。只有确认月付金额为 ¥0.00 才会创建订单。</p>
      </div>
      <div class="hero-orbit" aria-hidden="true">
        <span class="orbit-core"></span>
        <span class="orbit-path"></span>
        <span class="orbit-dot"></span>
      </div>
    </section>

    <section class="config-card">
      <div class="section-heading">
        <div>
          <span class="section-eyebrow">本月配置</span>
          <h2>优惠码</h2>
        </div>
        <n-tag v-if="config.configured && !couponDirty" type="success" :bordered="false">已保存</n-tag>
        <n-tag v-else type="warning" :bordered="false">待保存</n-tag>
      </div>
      <div class="coupon-row">
        <n-input
          v-model:value="couponCode"
          :disabled="runActive"
          placeholder="输入本月优惠码"
          :input-props="couponInputProps"
          @update:value="couponDirty = true"
        />
        <n-button :loading="configSaving" :disabled="runActive || !couponCode.trim()" @click="saveCoupon()">保存优惠码</n-button>
        <n-button type="primary" class="run-button" :loading="startingRun" :disabled="runActive || accountModalVisible || !accounts.some((item) => item.enabled) || !couponCode.trim()" @click="startRun">
          运行续费
        </n-button>
      </div>
      <div class="safety-note">非零金额、待支付订单和不适用月付的优惠码都会停止该账号，不会自动付款或取消订单。</div>
    </section>

    <section class="accounts-card">
      <div class="section-heading accounts-heading">
        <div>
          <span class="section-eyebrow">账号队列</span>
          <h2>{{ accounts.length }} 个账号</h2>
        </div>
        <n-button type="primary" secondary :disabled="runActive" @click="openCreateAccount">添加账号</n-button>
      </div>

      <div class="accounts-table-wrap">
        <table class="accounts-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>状态</th>
              <th>套餐到期</th>
              <th>上次结果</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="empty-cell">正在读取配置...</td>
            </tr>
            <tr v-else-if="!accounts.length">
              <td colspan="5" class="empty-cell">还没有账号，添加后即可加入本月续费队列。</td>
            </tr>
            <tr v-for="account in accounts" v-else :key="account.id" :class="{ 'is-current': currentRun?.currentAccountId === account.id }">
              <td>
                <div class="account-identity">
                  <span class="account-avatar">{{ account.email.slice(0, 1).toUpperCase() }}</span>
                  <div>
                    <strong>{{ account.email }}</strong>
                    <small v-if="currentRun?.currentAccountId === account.id">正在续费</small>
                  </div>
                </div>
              </td>
              <td><n-tag :type="account.enabled ? 'success' : 'default'" size="small" :bordered="false">{{ account.enabled ? '启用' : '停用' }}</n-tag></td>
              <td>{{ formatExpiry(account.expiredAt) }}</td>
              <td>
                <div class="last-result">
                  <n-tag v-if="account.lastStatus" :type="resultTagType(account.lastStatus)" size="small" :bordered="false">{{ resultLabel(account.lastStatus) }}</n-tag>
                  <span :title="account.lastMessage || ''">{{ account.lastMessage || '尚未运行' }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <n-button size="small" :disabled="runActive" @click="openEditAccount(account)">编辑</n-button>
                  <n-button size="small" type="error" ghost :disabled="runActive" @click="confirmDelete(account)">删除</n-button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="embedded && accountModalVisible" class="inline-account-editor">
        <div class="inline-editor-heading">
          <div>
            <span class="section-eyebrow">账号配置</span>
            <h3>{{ editingAccount ? '编辑宝可梦账号' : '添加宝可梦账号' }}</h3>
          </div>
          <n-button text :disabled="accountSaving" @click="accountModalVisible = false">取消</n-button>
        </div>
        <n-form label-placement="top" autocomplete="off">
          <div class="inline-editor-grid">
            <n-form-item label="账号邮箱">
              <n-input v-model:value="accountForm.email" placeholder="name@example.com" :input-props="emailInputProps" />
            </n-form-item>
            <n-form-item :label="editingAccount ? '密码（留空则不修改）' : '密码'">
              <SecretInput v-model:value="accountForm.password" :placeholder="editingAccount ? '留空保留当前密码' : '输入登录密码'" :input-props="passwordInputProps" />
            </n-form-item>
          </div>
          <div class="inline-editor-footer">
            <n-checkbox v-model:checked="accountForm.enabled">加入续费队列</n-checkbox>
            <n-button type="primary" :loading="accountSaving" @click="saveAccount">保存账号</n-button>
          </div>
        </n-form>
      </section>
    </section>

    <section class="run-card">
      <div class="section-heading run-heading">
        <div>
          <span class="section-eyebrow">执行轨迹</span>
          <h2>{{ currentRun ? runTitle(currentRun) : '等待运行' }}</h2>
        </div>
        <div v-if="currentRun" class="run-progress-copy">{{ currentRun.progress }}%</div>
      </div>

      <div v-if="currentRun" class="progress-track" :aria-label="`续费进度 ${currentRun.progress}%`">
        <span :style="{ width: `${currentRun.progress}%` }"></span>
      </div>

      <div v-if="currentRun" class="summary-strip">
        <div><span>总账号</span><strong>{{ currentRun.totalCount }}</strong></div>
        <div class="is-success"><span>成功</span><strong>{{ currentRun.successCount }}</strong></div>
        <div class="is-skipped"><span>跳过</span><strong>{{ currentRun.skippedCount }}</strong></div>
        <div class="is-failed"><span>失败</span><strong>{{ currentRun.failedCount }}</strong></div>
      </div>

      <div ref="logBox" class="renewal-log" role="log" aria-live="polite">
        <div v-if="!currentRun?.logs.length" class="log-empty">
          运行后会在这里依次显示登录、优惠校验、零元订单和到期时间刷新状态。
        </div>
        <div v-for="(entry, index) in currentRun?.logs || []" :key="`${entry.at}-${index}`" class="log-line" :class="`is-${entry.level}`">
          <time>{{ formatLogTime(entry.at) }}</time>
          <span class="log-account">{{ entry.accountEmail || '任务' }}</span>
          <span class="log-stage">{{ stageLabel(entry.stage) }}</span>
          <span class="log-message">{{ entry.message }}</span>
        </div>
      </div>

      <div v-if="currentRun?.results.length" class="result-list">
        <article v-for="result in currentRun.results" :key="result.id" class="result-item">
          <div>
            <n-tag :type="resultTagType(result.status)" size="small" :bordered="false">{{ resultLabel(result.status) }}</n-tag>
            <strong>{{ result.accountEmail }}</strong>
          </div>
          <p>{{ result.message }}</p>
          <span>{{ formatExpiry(result.expiredAtBefore) }} → {{ formatExpiry(result.expiredAtAfter) }}</span>
        </article>
      </div>
    </section>

    <n-modal v-if="!embedded" v-model:show="accountModalVisible" preset="card" class="pokemon-account-modal" :title="editingAccount ? '编辑宝可梦账号' : '添加宝可梦账号'" style="width: min(520px, 94vw); border-radius: 14px;">
      <n-form label-placement="top" autocomplete="off">
        <n-form-item label="账号邮箱">
          <n-input v-model:value="accountForm.email" placeholder="name@example.com" :input-props="emailInputProps" />
        </n-form-item>
        <n-form-item :label="editingAccount ? '密码（留空则不修改）' : '密码'">
          <SecretInput v-model:value="accountForm.password" :placeholder="editingAccount ? '留空保留当前密码' : '输入登录密码'" :input-props="passwordInputProps" />
        </n-form-item>
        <n-checkbox v-model:checked="accountForm.enabled">加入续费队列</n-checkbox>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="accountModalVisible = false">取消</n-button>
          <n-button type="primary" :loading="accountSaving" @click="saveAccount">保存账号</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NTag,
  createDiscreteApi
} from 'naive-ui';
import { api, UnauthorizedError } from '../api';
import SecretInput from '../components/SecretInput.vue';
import type {
  PokemonRenewalAccount,
  PokemonRenewalAccountStatus,
  PokemonRenewalConfig,
  PokemonRenewalRunSnapshot
} from '../types';

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });
const emit = defineEmits<{ accountsChanged: [accounts: PokemonRenewalAccount[]] }>();

const router = useRouter();
const { message, dialog } = createDiscreteApi(['message', 'dialog']);
const RUN_STORAGE_KEY = 'pokemon-renewal-active-run-id';

const accounts = ref<PokemonRenewalAccount[]>([]);
const config = reactive<PokemonRenewalConfig>({ couponCode: '', configured: false });
const couponCode = ref('');
const couponDirty = ref(false);
const currentRun = ref<PokemonRenewalRunSnapshot | null>(null);
const loading = ref(true);
const configSaving = ref(false);
const startingRun = ref(false);
const accountSaving = ref(false);
const accountModalVisible = ref(false);
const editingAccount = ref<PokemonRenewalAccount | null>(null);
const logBox = ref<HTMLElement | null>(null);
const accountForm = reactive({ email: '', password: '', enabled: true });
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const runActive = computed(() => currentRun.value?.status === 'running');
const couponInputProps = { autocomplete: 'off', name: 'pokemon-coupon-code', spellcheck: false };
const emailInputProps = { autocomplete: 'off', name: 'pokemon-account-email', spellcheck: false };
const passwordInputProps = { autocomplete: 'new-password', name: 'pokemon-account-password', spellcheck: false };

function handleError(error: unknown): void {
  if (error instanceof UnauthorizedError) {
    window.location.assign(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
    return;
  }
  message.error(error instanceof Error ? error.message : '操作失败');
}

async function loadAccounts(): Promise<void> {
  accounts.value = await api.listPokemonRenewalAccounts();
}

async function loadInitial(): Promise<void> {
  loading.value = true;
  try {
    const [loadedAccounts, loadedConfig, runs] = await Promise.all([
      api.listPokemonRenewalAccounts(),
      api.getPokemonRenewalConfig(),
      api.listPokemonRenewalRuns(1)
    ]);
    accounts.value = loadedAccounts;
    Object.assign(config, loadedConfig);
    couponCode.value = loadedConfig.couponCode;
    couponDirty.value = false;
    const storedRunId = localStorage.getItem(RUN_STORAGE_KEY);
    const latest = runs[0] || null;
    if (storedRunId && latest?.id !== storedRunId) {
      currentRun.value = await api.getPokemonRenewalRun(storedRunId).catch(() => latest);
    } else {
      currentRun.value = latest;
    }
    if (currentRun.value?.status === 'running') schedulePoll();
    else localStorage.removeItem(RUN_STORAGE_KEY);
  } catch (error) {
    handleError(error);
  } finally {
    loading.value = false;
  }
}

async function saveCoupon(showSuccess = true): Promise<boolean> {
  configSaving.value = true;
  try {
    const saved = await api.updatePokemonRenewalConfig(couponCode.value.trim());
    Object.assign(config, saved);
    couponCode.value = saved.couponCode;
    couponDirty.value = false;
    if (showSuccess) message.success('本月优惠码已保存');
    return true;
  } catch (error) {
    handleError(error);
    return false;
  } finally {
    configSaving.value = false;
  }
}

async function startRun(): Promise<void> {
  if (couponDirty.value || !config.configured) {
    const saved = await saveCoupon(false);
    if (!saved) return;
  }
  startingRun.value = true;
  try {
    currentRun.value = await api.startPokemonRenewalRun();
    localStorage.setItem(RUN_STORAGE_KEY, currentRun.value.id);
    message.success('续费任务已开始，将按账号顺序执行');
    schedulePoll(300);
  } catch (error) {
    handleError(error);
  } finally {
    startingRun.value = false;
  }
}

function schedulePoll(delay = 1_500): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void pollRun(), delay);
}

async function pollRun(): Promise<void> {
  const id = currentRun.value?.id || localStorage.getItem(RUN_STORAGE_KEY);
  if (!id) return;
  try {
    currentRun.value = await api.getPokemonRenewalRun(id);
    if (currentRun.value.status === 'running') {
      schedulePoll();
      return;
    }
    localStorage.removeItem(RUN_STORAGE_KEY);
    await loadAccounts();
    const summary = `续费完成：成功 ${currentRun.value.successCount}，跳过 ${currentRun.value.skippedCount}，失败 ${currentRun.value.failedCount}`;
    (currentRun.value.failedCount > 0 ? message.warning : message.success)(summary);
  } catch (error) {
    handleError(error);
    schedulePoll(3_000);
  }
}

function openCreateAccount(): void {
  editingAccount.value = null;
  Object.assign(accountForm, { email: '', password: '', enabled: true });
  accountModalVisible.value = true;
}

function openEditAccount(account: PokemonRenewalAccount): void {
  editingAccount.value = account;
  Object.assign(accountForm, { email: account.email, password: '', enabled: account.enabled });
  accountModalVisible.value = true;
}

async function saveAccount(): Promise<void> {
  const email = accountForm.email.trim();
  if (!email) {
    message.warning('请输入账号邮箱');
    return;
  }
  if (!editingAccount.value && !accountForm.password) {
    message.warning('请输入账号密码');
    return;
  }
  accountSaving.value = true;
  try {
    if (editingAccount.value) {
      await api.updatePokemonRenewalAccount(editingAccount.value.id, {
        email,
        enabled: accountForm.enabled,
        ...(accountForm.password ? { password: accountForm.password } : {})
      });
      message.success('账号已更新');
    } else {
      await api.createPokemonRenewalAccount({ email, password: accountForm.password, enabled: accountForm.enabled });
      message.success('账号已添加');
    }
    accountModalVisible.value = false;
    await loadAccounts();
    emit('accountsChanged', [...accounts.value]);
  } catch (error) {
    handleError(error);
  } finally {
    accountSaving.value = false;
  }
}

function confirmDelete(account: PokemonRenewalAccount): void {
  dialog.warning({
    title: '删除宝可梦账号',
    content: `确认删除 ${account.email}？历史续费结果会保留账号快照。`,
    positiveText: '删除',
    negativeText: '取消',
    async onPositiveClick() {
      try {
        await api.deletePokemonRenewalAccount(account.id);
        message.success('账号已删除');
        await loadAccounts();
        emit('accountsChanged', [...accounts.value]);
      } catch (error) {
        handleError(error);
      }
    }
  });
}

function formatExpiry(value: number | null | undefined): string {
  if (value == null) return '未读取';
  return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false });
}

function formatLogTime(value: number): string {
  return new Date(value * 1000).toLocaleTimeString('zh-CN', { hour12: false });
}

function resultLabel(status: PokemonRenewalAccountStatus): string {
  if (status === 'success') return '成功';
  if (status === 'skipped') return '跳过';
  return '失败';
}

function resultTagType(status: PokemonRenewalAccountStatus): 'success' | 'warning' | 'error' {
  if (status === 'success') return 'success';
  if (status === 'skipped') return 'warning';
  return 'error';
}

function runTitle(run: PokemonRenewalRunSnapshot): string {
  if (run.status === 'running') return run.message || '正在续费';
  if (run.status === 'completed') return '最近一次续费已完成';
  if (run.status === 'interrupted') return '最近一次续费已中断';
  return '最近一次续费异常结束';
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    start: '任务', account: '账号', login: '登录', profile: '到期', coupon: '优惠',
    order: '订单', checkout: '结算', confirm: '确认', complete: '完成', failed: '失败', summary: '汇总', fatal: '异常'
  };
  return labels[stage] || stage;
}

watch(() => currentRun.value?.logs.length, async () => {
  await nextTick();
  if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
});

onMounted(() => void loadInitial());
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<style scoped>
.pokemon-page {
  --poke-ink: #18213b;
  --poke-blue: #4665e8;
  --poke-violet: #7657e8;
  --poke-mint: #16a47d;
  --poke-amber: #df8b27;
  --poke-paper: #f6f8fc;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  color: var(--poke-ink);
}

.pokemon-page.is-embedded {
  gap: 14px;
}

.pokemon-page.is-embedded .config-card,
.pokemon-page.is-embedded .accounts-card,
.pokemon-page.is-embedded .run-card {
  padding: 18px;
  border-radius: 13px;
  box-shadow: none;
}

.renewal-hero {
  position: relative;
  min-height: 190px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 34px;
  border: 1px solid #dce3f2;
  border-radius: 18px;
  background: linear-gradient(118deg, #ffffff 0%, #f1f5ff 62%, #eeeaff 100%);
  box-shadow: 0 12px 34px rgba(49, 69, 123, 0.08);
}

.hero-copy { position: relative; z-index: 2; max-width: 720px; }
.back-link { border: 0; background: transparent; padding: 0; color: #61708d; cursor: pointer; font: inherit; }
.back-link:hover, .back-link:focus-visible { color: var(--poke-blue); }
.hero-kicker, .section-eyebrow { display: block; margin-top: 22px; color: var(--poke-violet); font-size: 11px; font-weight: 800; letter-spacing: .18em; }
.renewal-hero h2 { margin: 7px 0 8px; font-size: clamp(28px, 4vw, 42px); line-height: 1.08; letter-spacing: -.035em; }
.renewal-hero p { margin: 0; color: #64708a; font-size: 15px; line-height: 1.7; }

.hero-orbit { position: relative; flex: 0 0 170px; height: 150px; margin-right: 15px; }
.orbit-core { position: absolute; inset: 50% auto auto 50%; width: 54px; height: 54px; transform: translate(-50%, -50%); border: 11px solid #fff; border-radius: 50%; background: linear-gradient(145deg, var(--poke-blue), var(--poke-violet)); box-shadow: 0 10px 30px rgba(79, 92, 202, .28); }
.orbit-path { position: absolute; inset: 18px 8px; border: 1px solid rgba(74, 95, 209, .25); border-radius: 50%; transform: rotate(-18deg); }
.orbit-dot { position: absolute; top: 28px; right: 25px; width: 16px; height: 16px; border: 4px solid #fff; border-radius: 50%; background: #f1a43c; box-shadow: 0 4px 12px rgba(187, 114, 21, .28); }

.config-card, .accounts-card, .run-card { min-width: 0; padding: 24px; border: 1px solid #e1e6ef; border-radius: 16px; background: #fff; box-shadow: 0 8px 26px rgba(40, 58, 102, .05); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.section-heading .section-eyebrow { margin: 0 0 4px; }
.section-heading h2 { margin: 0; font-size: 20px; letter-spacing: -.02em; }
.coupon-row { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto; gap: 10px; }
.run-button { min-width: 112px; background: linear-gradient(135deg, var(--poke-blue), var(--poke-violet)); }
.safety-note { margin-top: 11px; color: #7a8499; font-size: 12px; }

.accounts-table-wrap { overflow-x: auto; }
.accounts-table { width: 100%; min-width: 820px; border-collapse: collapse; }
.accounts-table th { padding: 10px 14px; border-bottom: 1px solid #e8ebf2; color: #778198; font-size: 12px; font-weight: 600; text-align: left; }
.accounts-table td { padding: 15px 14px; border-bottom: 1px solid #eef1f6; vertical-align: middle; }
.accounts-table tbody tr { transition: background .18s ease, box-shadow .18s ease; }
.accounts-table tbody tr:hover { background: #fafbfe; }
.accounts-table tbody tr.is-current { background: #f1f5ff; box-shadow: inset 3px 0 var(--poke-blue); }
.empty-cell { padding: 40px !important; color: #8992a6; text-align: center; }
.account-identity { display: flex; align-items: center; gap: 10px; }
.account-avatar { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: #edf1ff; color: var(--poke-blue); font-weight: 800; }
.account-identity strong { display: block; font-size: 13px; }
.account-identity small { color: var(--poke-blue); }
.last-result { display: flex; align-items: center; gap: 8px; max-width: 330px; }
.last-result > span:last-child { overflow: hidden; color: #667189; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.row-actions { display: flex; gap: 7px; }

.inline-account-editor { margin-top: 16px; padding: 16px; border: 1px solid #dfe4f0; border-radius: 12px; background: #f8f9fd; }
.inline-editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.inline-editor-heading .section-eyebrow { margin: 0 0 3px; }
.inline-editor-heading h3 { margin: 0; font-size: 16px; }
.inline-editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.inline-editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; }

.run-heading { margin-bottom: 12px; }
.run-progress-copy { color: var(--poke-blue); font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
.progress-track { height: 7px; overflow: hidden; margin-bottom: 18px; border-radius: 999px; background: #ebeff7; }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--poke-blue), var(--poke-violet)); transition: width .35s ease; }
.summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 16px; overflow: hidden; border: 1px solid #e6eaf2; border-radius: 12px; }
.summary-strip div { display: flex; align-items: baseline; justify-content: space-between; padding: 12px 16px; border-right: 1px solid #e6eaf2; }
.summary-strip div:last-child { border-right: 0; }
.summary-strip span { color: #7c879d; font-size: 12px; }
.summary-strip strong { font-size: 20px; }
.summary-strip .is-success strong { color: var(--poke-mint); }
.summary-strip .is-skipped strong { color: var(--poke-amber); }
.summary-strip .is-failed strong { color: #d74d58; }

.renewal-log { max-height: 360px; min-height: 170px; overflow: auto; padding: 14px 16px; border: 1px solid #202b45; border-radius: 13px; background: #121a2b; color: #cdd7ec; font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace; font-size: 12px; line-height: 1.7; }
.log-empty { display: grid; min-height: 140px; place-items: center; color: #73819d; text-align: center; }
.log-line { display: grid; grid-template-columns: 72px minmax(130px, 210px) 42px 1fr; gap: 10px; padding: 3px 0; }
.log-line time { color: #697995; }
.log-account { overflow: hidden; color: #91a5cb; text-overflow: ellipsis; white-space: nowrap; }
.log-stage { color: #a697ef; }
.log-line.is-success .log-message { color: #75dfbd; }
.log-line.is-warning .log-message { color: #f0bd70; }
.log-line.is-error .log-message { color: #ff8993; }
.result-list { display: grid; gap: 8px; margin-top: 16px; }
.result-item { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(180px, 1fr) auto; align-items: center; gap: 14px; padding: 12px 14px; border: 1px solid #e7eaf1; border-radius: 11px; background: var(--poke-paper); }
.result-item > div { display: flex; align-items: center; gap: 9px; }
.result-item p { margin: 0; color: #667189; font-size: 12px; }
.result-item > span { color: #7c879c; font-size: 11px; white-space: nowrap; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; }

@media (max-width: 760px) {
  .renewal-hero { min-height: 0; padding: 24px; }
  .hero-orbit { display: none; }
  .coupon-row { grid-template-columns: 1fr 1fr; }
  .coupon-row :deep(.n-input) { grid-column: 1 / -1; }
  .summary-strip { grid-template-columns: repeat(2, 1fr); }
  .summary-strip div:nth-child(2) { border-right: 0; }
  .summary-strip div:nth-child(-n+2) { border-bottom: 1px solid #e6eaf2; }
  .log-line { grid-template-columns: 64px 1fr; gap: 2px 8px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
  .log-stage { display: none; }
  .log-message { grid-column: 2; }
  .result-item { grid-template-columns: 1fr; gap: 6px; }
  .result-item > span { white-space: normal; }
  .inline-editor-grid { grid-template-columns: 1fr; gap: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .progress-track span, .accounts-table tbody tr { transition: none; }
}
</style>
