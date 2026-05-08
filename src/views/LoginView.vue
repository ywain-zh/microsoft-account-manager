<template>
  <div class="auth-page auth-page-spec login-container">
    <n-card :bordered="false" class="auth-card auth-card-login-spec login-card">
      <div class="auth-card-body auth-card-body-spec">
        <div class="login-header">
          <WangyueLogo class="login-logo" />
          <h2 id="login-title">望月工具箱</h2>
          <p>欢迎回来</p>
        </div>

        <form class="auth-form-shell login-form" @submit.prevent="handleSubmit">
          <n-form class="auth-form-single auth-form-spec" label-placement="top" :show-label="false">
            <n-form-item>
              <n-input
                v-model:value="form.username"
                autocomplete="username"
                class="modern-input"
                placeholder="管理员账号"
                spellcheck="false"
              >
                <template #prefix>
                  <span class="auth-input-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 13.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Z"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.7"
                      />
                      <path
                        d="M5.5 19.25a6.5 6.5 0 0 1 13 0"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.7"
                      />
                    </svg>
                  </span>
                </template>
              </n-input>
            </n-form-item>

            <n-form-item>
              <n-input
                v-model:value="form.password"
                autocomplete="current-password"
                class="modern-input"
                type="password"
                show-password-on="click"
                placeholder="密码"
              >
                <template #prefix>
                  <span class="auth-input-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path
                        d="M8.75 10V8.5a3.25 3.25 0 0 1 6.5 0V10"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.7"
                      />
                      <rect
                        x="5.75"
                        y="10"
                        width="12.5"
                        height="9.25"
                        rx="2.25"
                        stroke="currentColor"
                        stroke-width="1.7"
                      />
                    </svg>
                  </span>
                </template>
              </n-input>
            </n-form-item>
          </n-form>

          <div class="auth-submit-row auth-submit-row-full">
            <n-button
              attr-type="submit"
              class="auth-primary-button auth-primary-button-full login-btn"
              type="primary"
              size="large"
              :loading="loginLoading"
            >
              登录
            </n-button>
          </div>
        </form>

        <div class="login-footer">
          <p class="auth-footer-note auth-footer-note-centered">仅限管理员使用，所有操作都在登录后执行。</p>
        </div>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { NButton, NCard, NForm, NFormItem, NInput } from 'naive-ui';
import { useRoute, useRouter } from 'vue-router';
import WangyueLogo from '../components/WangyueLogo.vue';
import { defaultConsoleRoute } from '../config/navigation';
import { useAdminConsole } from '../state/admin-console';

const admin = useAdminConsole();
const { loginLoading } = admin;
const route = useRoute();
const router = useRouter();

const form = reactive({
  username: 'admin',
  password: ''
});

async function handleSubmit(): Promise<void> {
  const success = await admin.login({
    username: form.username,
    password: form.password
  });

  if (!success) {
    return;
  }

  form.password = '';

  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : defaultConsoleRoute;
  await router.replace(redirect || defaultConsoleRoute);
}
</script>
