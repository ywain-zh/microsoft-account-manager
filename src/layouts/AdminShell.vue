<template>
  <div class="console-shell console-shell-spec">
    <aside class="console-sidebar">
      <div class="console-brand console-brand-spec">
        <span class="console-brand-badge console-brand-badge-letter" aria-hidden="true">M</span>
        <div class="console-brand-title-wrap console-brand-title-wrap-spec">
          <h1 class="console-brand-title">Microsoft Account Manager</h1>
          <p class="console-brand-subtitle">Admin Console</p>
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
      <header class="console-header console-header-bar">
        <div class="console-header-copy">
          <p class="console-header-kicker">Admin Console</p>
          <span class="console-header-context">{{ currentGroupLabel }}</span>
        </div>

        <div class="console-header-actions">
          <div class="console-user-chip">
            <span class="console-user-chip-label">当前登录</span>
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
      </header>

      <section class="console-content">
        <RouterView />
      </section>
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
