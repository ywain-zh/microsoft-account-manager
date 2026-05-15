<template>
  <main class="public-share-page">
    <section class="public-share-shell">
      <header class="public-share-header">
        <div>
          <p class="public-share-kicker">Cloud Mail</p>
          <h1>共享收件箱</h1>
          <p class="public-share-account">{{ account || '正在加载...' }}</p>
        </div>
        <n-button
          size="small"
          class="public-share-refresh"
          :loading="loading"
          :disabled="!token"
          @click="loadInbox(true)"
        >
          刷新
        </n-button>
      </header>

      <div v-if="errorMessage" class="public-share-error">
        <strong>{{ errorMessage }}</strong>
        <n-button size="small" class="public-share-retry" :loading="loading" @click="loadInbox(true)">
          重试
        </n-button>
      </div>

      <div v-else class="public-share-inbox">
        <aside class="public-share-list">
          <n-spin :show="loading">
            <n-empty v-if="!loading && messages.length === 0" description="暂无邮件" />
            <button
              v-for="item in messages"
              :key="item.id"
              type="button"
              class="public-share-mail-item"
              :class="{ active: selectedMailId === item.id }"
              @click="selectedMailId = item.id"
            >
              <div class="public-share-mail-topline">
                <span class="public-share-mail-from" :title="item.from || '未知发件人'">
                  {{ item.from || '未知发件人' }}
                </span>
                <span class="public-share-mail-date">{{ formatDate(item.receivedAt) }}</span>
              </div>
              <div class="public-share-mail-badges">
                <span class="public-share-folder-badge" :class="`public-share-folder-${item.folderKind}`">
                  {{ item.folderLabel }}
                </span>
              </div>
              <strong class="public-share-mail-subject" :title="item.subject || '(无主题)'">
                {{ item.subject || '(无主题)' }}
              </strong>
              <p class="public-share-mail-preview" :title="resolveSnippet(item)">
                {{ resolveSnippet(item) || '暂无邮件摘要' }}
              </p>
            </button>
          </n-spin>
        </aside>

        <section class="public-share-detail">
          <div v-if="!selectedMail" class="public-share-empty-detail">
            请选择一封邮件进行阅读
          </div>
          <article v-else class="public-share-mail-detail">
            <header class="public-share-detail-header">
              <div class="public-share-detail-title-row">
                <h2>{{ selectedMail.subject || '(无主题)' }}</h2>
                <span class="public-share-folder-badge" :class="`public-share-folder-${selectedMail.folderKind}`">
                  {{ selectedMail.folderLabel }}
                </span>
              </div>
              <div class="public-share-meta">
                <div><strong>发件人:</strong> {{ selectedMail.from || '-' }}</div>
                <div><strong>收件人:</strong> {{ account || '-' }}</div>
                <div><strong>时 间:</strong> {{ formatDate(selectedMail.receivedAt) }}</div>
              </div>
            </header>
            <div class="public-share-mail-body">
              <iframe
                class="public-share-mail-frame"
                :title="selectedMail.subject || '邮件正文'"
                :srcdoc="renderedMail.srcdoc"
                sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                referrerpolicy="no-referrer"
              />
            </div>
          </article>
        </section>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NEmpty, NSpin } from 'naive-ui';
import { api } from '../api';
import type { AccountMailItem } from '../types';
import { buildMailPreview, extractMailSnippet } from '../utils/mail-preview';

const route = useRoute();
const token = computed(() => {
  const value = route.params.token;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
});

const loading = ref(false);
const account = ref('');
const messages = ref<AccountMailItem[]>([]);
const selectedMailId = ref('');
const errorMessage = ref('');

const selectedMail = computed(() => {
  return messages.value.find((item) => item.id === selectedMailId.value) ?? null;
});

const renderedMail = computed(() => buildMailPreview(selectedMail.value));

function resolveSnippet(item: AccountMailItem): string {
  return extractMailSnippet(item);
}

function formatDate(value: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

async function loadInbox(forceSelection = false): Promise<void> {
  if (!token.value || loading.value) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    const response = await api.getPublicCloudMailShareInbox(token.value);
    account.value = response.account;
    messages.value = response.messages;
    if (forceSelection || !messages.value.some((item) => item.id === selectedMailId.value)) {
      selectedMailId.value = response.messages[0]?.id ?? '';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '分享链接读取失败';
    errorMessage.value = message;
    messages.value = [];
    selectedMailId.value = '';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadInbox(true);
});
</script>

<style scoped>
.public-share-page {
  min-height: 100vh;
  background: #f4f7fb;
  color: #172033;
  padding: 24px;
}

.public-share-shell {
  width: min(1280px, 100%);
  margin: 0 auto;
}

.public-share-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 88px;
}

.public-share-kicker {
  margin: 0 0 4px;
  color: #2f6fed;
  font-size: 13px;
  font-weight: 700;
}

.public-share-header h1 {
  margin: 0;
  color: #071226;
  font-size: 28px;
  line-height: 1.2;
}

.public-share-account {
  margin: 6px 0 0;
  color: #66758f;
  font-size: 14px;
}

.public-share-refresh,
.public-share-retry {
  cursor: pointer;
}

.public-share-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  padding: 14px 16px;
  border: 1px solid #ffd0d0;
  border-radius: 8px;
  background: #fff6f6;
  color: #b42318;
}

.public-share-inbox {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  height: calc(100vh - 144px);
  min-height: 560px;
  border: 1px solid #dfe7f3;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
  box-shadow: 0 16px 40px rgba(16, 31, 62, 0.08);
}

.public-share-list {
  border-right: 1px solid #e7edf6;
  overflow: auto;
  background: #f8fbff;
}

.public-share-list :deep(.n-spin-container) {
  min-height: 100%;
}

.public-share-mail-item {
  display: block;
  width: 100%;
  min-height: 118px;
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid #e7edf6;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease;
}

.public-share-mail-item:hover,
.public-share-mail-item.active {
  background: #ffffff;
}

.public-share-mail-item.active {
  border-left: 3px solid #2f6fed;
  padding-left: 13px;
}

.public-share-mail-topline,
.public-share-detail-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.public-share-mail-from,
.public-share-mail-subject,
.public-share-mail-preview {
  overflow: hidden;
  text-overflow: ellipsis;
}

.public-share-mail-from {
  color: #1e293b;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.public-share-mail-date {
  flex: 0 0 auto;
  color: #7b8aa4;
  font-size: 12px;
}

.public-share-mail-badges {
  margin-top: 8px;
}

.public-share-folder-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2458c9;
  font-size: 12px;
  font-weight: 700;
}

.public-share-folder-junk {
  background: #fff2df;
  color: #a65700;
}

.public-share-mail-subject {
  display: block;
  margin-top: 8px;
  color: #111827;
  font-size: 14px;
  line-height: 1.35;
  white-space: nowrap;
}

.public-share-mail-preview {
  display: -webkit-box;
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.public-share-detail {
  min-width: 0;
  overflow: auto;
}

.public-share-empty-detail {
  display: grid;
  min-height: 100%;
  place-items: center;
  color: #7b8aa4;
  font-size: 15px;
}

.public-share-mail-detail {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.public-share-detail-header {
  padding: 22px 24px 18px;
  border-bottom: 1px solid #e7edf6;
  background: #ffffff;
}

.public-share-detail-title-row h2 {
  min-width: 0;
  margin: 0;
  color: #071226;
  font-size: 20px;
  line-height: 1.35;
  word-break: break-word;
}

.public-share-meta {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  color: #64748b;
  font-size: 13px;
}

.public-share-meta strong {
  color: #34445e;
}

.public-share-mail-body {
  flex: 1;
  min-height: 0;
  padding: 0;
}

.public-share-mail-frame {
  display: block;
  width: 100%;
  min-height: calc(100vh - 274px);
  height: 100%;
  border: 0;
  background: #ffffff;
}

@media (max-width: 820px) {
  .public-share-page {
    padding: 14px;
  }

  .public-share-header {
    align-items: flex-start;
    min-height: 96px;
  }

  .public-share-header h1 {
    font-size: 24px;
  }

  .public-share-inbox {
    display: flex;
    flex-direction: column;
    height: auto;
    min-height: 0;
  }

  .public-share-list {
    max-height: 42vh;
    border-right: 0;
    border-bottom: 1px solid #e7edf6;
  }

  .public-share-detail {
    min-height: 480px;
  }

  .public-share-mail-frame {
    min-height: 420px;
  }
}
</style>
