<template>
  <div class="auth-page">
    <div class="auth-shell">
      <header class="auth-brand" aria-label="Mail Admin">
        <span class="auth-brand-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M4.75 7.25A2.25 2.25 0 0 1 7 5h10a2.25 2.25 0 0 1 2.25 2.25v9.5A2.25 2.25 0 0 1 17 19H7a2.25 2.25 0 0 1-2.25-2.25z"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.7"
            />
            <path
              d="m5.75 7 5.1 4.08a1.75 1.75 0 0 0 2.3 0L18.25 7"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.7"
            />
          </svg>
        </span>

        <div class="auth-brand-copy">
          <strong class="auth-brand-title">Mail Admin</strong>
          <p class="auth-brand-subtitle">Mailbox management console</p>
        </div>
      </header>

      <section class="auth-panel auth-panel-single" aria-labelledby="login-title">
        <n-card class="auth-card auth-card-single" bordered>
          <div class="auth-card-body">
            <div class="auth-card-header">
              <h1 id="login-title">欢迎回来</h1>
              <p>登录管理员账户以继续</p>
            </div>

            <form class="auth-form-shell" @submit.prevent="handleSubmit">
              <n-form class="auth-form-single" label-placement="top">
                <n-form-item label="管理员账号">
                  <n-input
                    v-model:value="form.username"
                    autocomplete="username"
                    placeholder="请输入管理员账号"
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

                <n-form-item label="密码">
                  <n-input
                    v-model:value="form.password"
                    autocomplete="current-password"
                    type="password"
                    show-password-on="click"
                    placeholder="请输入密码"
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

              <div class="auth-submit-row">
                <n-button attr-type="submit" type="primary" size="large" :loading="loginLoading">
                  <span class="auth-button-content">
                    <span class="auth-button-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path
                          d="M10.75 7.75h-1.5A2.25 2.25 0 0 0 7 10v7.25a2.25 2.25 0 0 0 2.25 2.25h5.5A2.25 2.25 0 0 0 17 17.25v-1.5"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="1.7"
                        />
                        <path
                          d="M13 11.5h6"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="1.7"
                        />
                        <path
                          d="m16 8.5 3 3-3 3"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="1.7"
                        />
                      </svg>
                    </span>
                    <span>登录</span>
                  </span>
                </n-button>
              </div>
            </form>
          </div>
        </n-card>
      </section>

      <div class="auth-meta-stack">
        <p class="auth-footer-note">仅限管理员使用，所有操作都在登录后执行。</p>
        <p class="auth-copyright">© 2026 Mail Admin. All rights reserved.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { NButton, NCard, NForm, NFormItem, NInput } from 'naive-ui';
import { useRoute, useRouter } from 'vue-router';
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
