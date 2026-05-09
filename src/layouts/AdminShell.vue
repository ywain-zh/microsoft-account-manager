<template>
  <div class="console-shell console-shell-flat">
    <aside class="console-sidebar-flat">
      <div class="console-brand-flat">
        <WangyueLogo class="console-brand-logo" />
        <span class="console-brand-name">望月工具箱</span>
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
            <svg v-else-if="item.key === 'sub2api'" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4.5v3"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M12 16.5v3"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M5.75 12h3"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M15.25 12h3"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                stroke-width="1.7"
              />
            </svg>
            <svg v-else-if="item.key === 'system-settings'" viewBox="0 0 24 24" fill="none">
              <path
                d="M4.75 7.5h14.5"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M4.75 16.5h14.5"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M8.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                stroke="currentColor"
                stroke-width="1.7"
              />
              <path
                d="M15.5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                stroke="currentColor"
                stroke-width="1.7"
              />
            </svg>
            <svg v-else-if="item.key === '779-cards'" viewBox="0 0 24 24" fill="none">
              <rect
                x="3.75"
                y="6.25"
                width="16.5"
                height="11.5"
                rx="2.25"
                stroke="currentColor"
                stroke-width="1.7"
              />
              <path
                d="M3.75 10.25h16.5"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.7"
              />
              <path
                d="M7.25 14.25h3.5"
                stroke="currentColor"
                stroke-linecap="round"
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
        <div class="console-page-heading">
          <h1 class="console-page-title">{{ pageTitle }}</h1>
          <p class="console-page-desc">{{ pageDescription }}</p>
        </div>
        <div class="console-topbar-actions">
          <n-dropdown :options="userMenuOptions" trigger="click" @select="handleUserMenuSelect">
            <button class="console-admin-profile" type="button" aria-label="当前管理员菜单">
              <span class="console-admin-avatar">{{ userInitials }}</span>
              <span class="console-admin-copy">
                <strong>{{ currentUser || 'admin' }}</strong>
                <small>Admin</small>
              </span>
              <span class="console-admin-caret" aria-hidden="true">▼</span>
            </button>
          </n-dropdown>
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
import { NDropdown } from 'naive-ui';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import WangyueLogo from '../components/WangyueLogo.vue';
import { consoleNavigation, defaultConsoleRoute } from '../config/navigation';
import { useAdminConsole } from '../state/admin-console';

const admin = useAdminConsole();
const { currentUser, isAuthenticated } = admin;
const route = useRoute();
const router = useRouter();
const navigation = consoleNavigation;
const pageTitle = computed(() => String(route.meta.title ?? '望月工具箱'));
const pageDescription = computed(() => String(route.meta.description ?? '管理后台工具与服务配置。'));
const userMenuOptions = [{ label: '退出登录', key: 'logout' }];
const userInitials = computed(() => {
  const normalized = (currentUser.value || 'admin').trim();
  return normalized.slice(0, 2).toUpperCase();
});

async function handleUserMenuSelect(key: string): Promise<void> {
  if (key !== 'logout') {
    return;
  }

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
