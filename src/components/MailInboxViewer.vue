<template>
  <n-modal
    :show="show"
    preset="card"
    :bordered="false"
    class="console-modal console-mail-modal inbox-modal inbox-modal-html-match"
    closable
    @update:show="handleShowUpdate"
  >
    <template #header>
      <div class="modal-header inbox-modal-header">
        <div class="modal-header-left">
          <h2>{{ title }}</h2>
          <div class="email-action-group">
            <p>{{ account || '-' }}</p>
            <button
              class="btn-small-action"
              type="button"
              title="复制邮箱"
              aria-label="复制邮箱"
              :disabled="!account"
              @click="emit('copy')"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect
                  x="9"
                  y="9"
                  width="13"
                  height="13"
                  rx="2"
                  ry="2"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>复制</span>
            </button>
            <button
              class="btn-small-action"
              type="button"
              title="刷新邮件"
              aria-label="刷新邮件"
              :disabled="!account || loading"
              @click="emit('refresh')"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" :class="{ spin: loading }">
                <polyline
                  points="23 4 23 10 17 10"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <polyline
                  points="1 20 1 14 7 14"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>刷新</span>
            </button>
          </div>
        </div>
      </div>
    </template>

    <div class="mail-viewer-shell inbox-split-view">
      <aside class="mail-viewer-sidebar inbox-sider">
        <n-spin :show="loading" class="mail-viewer-spin">
          <div v-if="items.length === 0" class="mail-viewer-empty-panel empty-state inbox-empty-state">
            <n-empty description="暂无邮件" />
          </div>

          <div v-else class="mail-viewer-list inbox-list">
            <button
              v-for="item in items"
              :key="item.id"
              class="mail-viewer-item inbox-mail-item"
              :class="{ active: selectedMail?.id === item.id }"
              type="button"
              @click="emit('select', item.id)"
            >
              <div class="mail-viewer-item-header mail-item-topline">
                <p class="mail-viewer-item-from mail-sender">{{ item.from || '未知发件人' }}</p>
                <p class="mail-viewer-item-time mail-date">{{ formatDate(item.receivedAt) }}</p>
              </div>
              <p class="mail-viewer-item-subject mail-subject">{{ item.subject || '(无主题)' }}</p>
            </button>
          </div>
        </n-spin>
      </aside>

      <section class="mail-viewer-reading-panel inbox-content">
        <div class="mail-viewer-reading-surface">
          <div v-if="!selectedMail" class="mail-viewer-empty-panel empty-state inbox-empty-state">
            请选择一封邮件进行阅读
          </div>

          <div v-else class="mail-viewer-reading-card mail-detail-container">
            <div class="mail-detail-header">
              <div class="mail-detail-subject">{{ selectedMail.subject || '(无主题)' }}</div>
              <div class="mail-meta-info">
                <div><strong>发件人:</strong> {{ selectedMail.from || '-' }}</div>
                <div><strong>收件人:</strong> {{ account || '-' }}</div>
                <div><strong>时 间:</strong> {{ formatDate(selectedMail.receivedAt) }}</div>
              </div>
            </div>

            <div class="mail-viewer-frame-shell mail-html-body" :class="`mail-viewer-frame-shell-${renderedMail.mode}`">
              <iframe
                class="mail-viewer-frame"
                :title="selectedMail.subject || '邮件正文'"
                :srcdoc="renderedMail.srcdoc"
                :style="{ height: `${iframeHeight}px` }"
                sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                referrerpolicy="no-referrer"
                @load="handleFrameLoad"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { NEmpty, NModal, NSpin } from 'naive-ui';
import type { AccountMailItem } from '../types';
import {
  buildMailPreview,
  defaultMailFrameHeight,
  extractMailSnippet,
  maxMailFrameHeight
} from '../utils/mail-preview';

interface MailInboxViewerProps {
  show: boolean;
  title: string;
  subtitle: string;
  account: string;
  items: AccountMailItem[];
  loading: boolean;
  selectedMailId: string;
  formatDate: (value: string) => string;
  showJunkBadge?: boolean;
}

const props = withDefaults(defineProps<MailInboxViewerProps>(), {
  showJunkBadge: true
});

const emit = defineEmits<{
  (event: 'update:show', value: boolean): void;
  (event: 'select', id: string): void;
  (event: 'copy'): void;
  (event: 'refresh'): void;
}>();

const selectedMail = computed(() => {
  return props.items.find((item) => item.id === props.selectedMailId) ?? null;
});

const renderedMail = computed(() => buildMailPreview(selectedMail.value));
const iframeHeight = ref(defaultMailFrameHeight);

watch(
  () => renderedMail.value.srcdoc,
  () => {
    iframeHeight.value = defaultMailFrameHeight;
  }
);

watch(
  () => props.show,
  (visible) => {
    if (!visible) {
      iframeHeight.value = defaultMailFrameHeight;
    }
  }
);

function handleShowUpdate(value: boolean): void {
  emit('update:show', value);
}

function handleFrameLoad(event: Event): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLIFrameElement)) {
    return;
  }

  void nextTick(() => {
    try {
      const rootHeight = target.contentDocument?.documentElement.scrollHeight ?? 0;
      const bodyHeight = target.contentDocument?.body.scrollHeight ?? 0;
      const nextHeight = Math.max(defaultMailFrameHeight, rootHeight, bodyHeight);
      iframeHeight.value = Math.min(nextHeight + 8, maxMailFrameHeight);
    } catch {
      iframeHeight.value = defaultMailFrameHeight;
    }
  });
}

function shouldShowFolderBadge(item: AccountMailItem): boolean {
  return props.showJunkBadge || item.folderKind !== 'junk';
}

function resolveSnippet(item: AccountMailItem): string {
  return extractMailSnippet(item);
}

function resolveModeLabel(mode: ReturnType<typeof buildMailPreview>['mode']): string {
  if (mode === 'html') {
    return 'HTML 邮件';
  }
  if (mode === 'text') {
    return '纯文本邮件';
  }
  return '空邮件';
}
</script>
