<template>
  <div class="console-shell">
    <aside class="console-sidebar">
      <div class="console-brand">
        <span class="console-brand-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M7.75 7.75h8.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-8.5a1.5 1.5 0 0 1-1.5-1.5v-5.5a1.5 1.5 0 0 1 1.5-1.5Z"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
            />
            <path
              d="m8.5 9 3.04 2.34a.75.75 0 0 0 .92 0L15.5 9"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
            />
          </svg>
        </span>
        <div class="console-brand-title-wrap">
          <h1 class="console-brand-title">邮箱管理</h1>
        </div>
      </div>

      <nav class="console-nav" aria-label="主导航">
        <section
          v-for="group in navigation"
          :key="group.key"
          class="console-nav-group"
          :class="{ 'console-nav-group-open': expandedGroups.includes(group.key) }"
        >
          <button
            class="console-nav-group-button"
            :class="{ 'console-nav-group-button-active': currentGroupKey === group.key }"
            type="button"
            :aria-expanded="expandedGroups.includes(group.key)"
            @click="toggleGroup(group.key)"
          >
            <span class="console-nav-group-leading">
              <span class="console-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5.75 8.25h12.5"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-width="1.5"
                  />
                  <path
                    d="M5.75 12h12.5"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-width="1.5"
                  />
                  <path
                    d="M5.75 15.75h7"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-width="1.5"
                  />
                </svg>
              </span>
              <span class="console-nav-label">{{ group.label }}</span>
            </span>
            <span class="console-nav-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="m8.75 10.5 3.25 3.25 3.25-3.25"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.7"
                />
              </svg>
            </span>
          </button>

          <div v-if="expandedGroups.includes(group.key)" class="console-subnav">
            <RouterLink
              v-for="item in group.children"
              :key="item.path"
              :to="item.path"
              class="console-subnav-link"
              :class="{ 'console-subnav-link-active': route.path === item.path }"
            >
              <span class="console-subnav-label">{{ item.label }}</span>
            </RouterLink>
          </div>
        </section>
      </nav>
    </aside>

    <main class="console-main">
      <div class="console-main-shell">
        <header class="console-header">
          <div class="console-header-panel">
            <div class="console-header-copy">
              <p class="console-header-kicker page-pill">{{ currentGroupLabel }}</p>
              <h2>{{ route.meta.title || '邮箱管理' }}</h2>
              <p>{{ route.meta.description || '在统一后台中管理邮箱服务。' }}</p>
            </div>

            <div class="console-user-card">
              <div>
                <p class="console-user-label">当前登录</p>
                <strong>{{ currentUser }}</strong>
              </div>
              <n-button
                secondary
                class="header-logout-button"
                :loading="logoutLoading"
                @click="handleLogout"
              >
                退出登录
              </n-button>
            </div>
          </div>
        </header>

        <section class="console-content">
          <RouterView />
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton } from 'naive-ui';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { consoleNavigation, defaultConsoleRoute } from '../config/navigation';
import { useAdminConsole } from '../state/admin-console';

const admin = useAdminConsole();
const { currentUser, isAuthenticated, logoutLoading } = admin;
const route = useRoute();
const router = useRouter();
const navigation = consoleNavigation;
const expandedGroups = ref(consoleNavigation.map((group) => group.key));

const currentGroupLabel = computed(() => {
  const matchedGroup = consoleNavigation.find((group) => {
    return group.children.some((item) => item.path === route.path);
  });
  return matchedGroup?.label ?? '邮箱服务';
});

const currentGroupKey = computed(() => {
  const matchedGroup = consoleNavigation.find((group) => {
    return group.children.some((item) => item.path === route.path);
  });
  return matchedGroup?.key ?? consoleNavigation[0]?.key ?? '';
});

function toggleGroup(key: string): void {
  if (expandedGroups.value.includes(key)) {
    expandedGroups.value = expandedGroups.value.filter((item) => item !== key);
    return;
  }

  expandedGroups.value = [...expandedGroups.value, key];
}

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
