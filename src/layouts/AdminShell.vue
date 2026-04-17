<template>
  <div class="console-shell console-shell-flat">
    <aside class="console-sidebar-flat">
      <div class="console-brand-flat">
        <span class="console-brand-mark" aria-hidden="true">M</span>
        <span class="console-brand-name">邮箱管理平台</span>
      </div>

      <nav class="console-nav-flat" aria-label="主导航">
        <RouterLink
          v-for="item in navigation"
          :key="item.path"
          :to="item.path"
          class="console-nav-link-flat"
          :class="{ 'console-nav-link-flat-active': route.path === item.path }"
        >
          <span class="console-nav-link-icon" aria-hidden="true">
            <svg v-if="item.key === 'cloud-mail'" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 18.25h9.25a4.25 4.25 0 1 0-.88-8.41A5.5 5.5 0 0 0 5.6 12.11 3.75 3.75 0 0 0 7 18.25Z"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.7"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none">
              <path
                d="M6.75 7.75h10.5v8.5H6.75z"
                stroke="currentColor"
                stroke-linejoin="round"
                stroke-width="1.7"
              />
              <path
                d="M6.75 10.5h10.5"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M9.5 5.75v2"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M14.5 5.75v2"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
            </svg>
          </span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
    </aside>

    <main class="console-main-flat">
      <header class="console-topbar-flat">
        <div class="console-topbar-spacer"></div>
        <div class="console-topbar-actions">
          <div class="console-user-flat">
            <span>当前登录: <strong>{{ currentUser }}</strong></span>
            <span class="console-user-avatar" aria-hidden="true">{{ userAvatarLabel }}</span>
          </div>
          <n-button text class="header-logout-button-flat" :loading="logoutLoading" @click="handleLogout">
            退出
          </n-button>
        </div>
      </header>

      <section class="console-content-flat">
        <RouterView />
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { NButton } from 'naive-ui';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { consoleNavigation, defaultConsoleRoute } from '../config/navigation';
import { useAdminConsole } from '../state/admin-console';

const admin = useAdminConsole();
const { currentUser, isAuthenticated, logoutLoading } = admin;
const route = useRoute();
const router = useRouter();
const navigation = consoleNavigation;

const userAvatarLabel = computed(() => {
  const normalized = currentUser.value.trim();
  return normalized ? normalized.slice(0, 1).toUpperCase() : 'A';
});

async function handleLogout(): Promise<void> {
  await admin.logout();
  await router.replace('/login');
}

watch(
  () => isAuthenticated.value,
  async (authenticated) => {
    if (authenticated) {
      return;
    }

    if (!route.matched.some((record) => record.meta.requiresAuth)) {
      return;
    }

    const redirect = route.fullPath || defaultConsoleRoute;
    await router.replace({
      path: '/login',
      query: { redirect }
    });
  }
);
</script>
