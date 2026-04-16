<template>
  <n-modal
    :show="show"
    preset="card"
    :bordered="false"
    class="console-modal console-mail-modal inbox-modal"
    closable
    @update:show="handleShowUpdate"
  >
    <template #header>
      <div class="modal-header mail-modal-header-spec">
        <div class="mail-modal-header-copy">
          <div class="header-left">
            <h2>{{ title }}</h2>
            <p>{{ account || '-' }}</p>
          </div>
          <p class="mail-modal-subtitle">{{ subtitle }}</p>
        </div>

        <div class="mail-modal-inline-actions">
          <button
            class="icon-button icon-button-muted"
            type="button"
            title="复制邮箱"
            aria-label="复制邮箱"
            :disabled="!account"
            @click="emit('copy')"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M7 7.75A1.75 1.75 0 0 1 8.75 6h6.5A1.75 1.75 0 0 1 17 7.75v6.5A1.75 1.75 0 0 1 15.25 16h-6.5A1.75 1.75 0 0 1 7 14.25z"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
              <path
                d="M4.75 13.25A1.75 1.75 0 0 1 3 11.5V5.25A1.75 1.75 0 0 1 4.75 3.5H11A1.75 1.75 0 0 1 12.75 5.25"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button
            class="icon-button icon-button-muted"
            type="button"
            title="刷新邮件"
            aria-label="刷新邮件"
            :disabled="!account || loading"
            @click="emit('refresh')"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M15.25 10a5.25 5.25 0 1 1-1.538-3.712"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M12.5 4.75h2.75V7.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <div class="mail-viewer-shell inbox-split-view">
      <aside class="mail-viewer-sidebar inbox-sider">
        <div class="mail-viewer-sidebar-head">
          <div>
            <p class="mail-viewer-kicker">最近邮件</p>
            <h3 class="mail-viewer-sidebar-title">{{ items.length }} 封消息</h3>
          </div>
        </div>

        <n-spin :show="loading" class="mail-viewer-spin">
          <div v-if="items.length === 0" class="mail-viewer-empty-panel empty-state">
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
              <p class="mail-viewer-item-snippet mail-snippet">{{ resolveSnippet(item) || '暂无摘要，打开后可查看正文。' }}</p>
              <div class="mail-viewer-item-footer mail-item-tags">
                <span
                  v-if="shouldShowFolderBadge(item)"
                  class="mail-folder-badge"
                  :class="`mail-folder-badge-${item.folderKind}`"
                  :title="item.folderLabel"
                >
                  <svg v-if="item.folderKind === 'inbox'" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M3.5 6.25A1.75 1.75 0 0 1 5.25 4.5h9.5A1.75 1.75 0 0 1 16.5 6.25v7.5A1.75 1.75 0 0 1 14.75 15.5h-9.5A1.75 1.75 0 0 1 3.5 13.75z"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linejoin="round"
                    />
                    <path
                      d="m4.25 6 5.088 4.07a1 1 0 0 0 1.248 0L15.75 6"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <svg v-else viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M10 4.25 16 15.5H4z"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linejoin="round"
                    />
                    <path d="M10 8v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M10 14h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  </svg>
                  <span>{{ item.folderLabel }}</span>
                </span>
              </div>
            </button>
          </div>
        </n-spin>
      </aside>

      <section class="mail-viewer-reading-panel inbox-content">
        <div class="mail-viewer-reading-surface">
          <div v-if="!selectedMail" class="mail-viewer-empty-panel empty-state">
            请选择一封邮件进行阅读
          </div>

          <div v-else class="mail-viewer-reading-card mail-detail-container">
            <div class="mail-detail-header">
              <div class="mail-detail-subject">{{ selectedMail.subject || '(无主题)' }}</div>
              <div class="mail-meta-info">
                <div><strong>发件人:</strong> {{ selectedMail.from || '-' }}</div>
                <div><strong>时 间:</strong> {{ formatDate(selectedMail.receivedAt) }}</div>
                <div><strong>邮 箱:</strong> {{ account || '-' }}</div>
                <div><strong>类 型:</strong> {{ resolveModeLabel(renderedMail.mode) }}</div>
              </div>
            </div>

            <div v-if="renderedMail.snippet" class="mail-detail-summary">
              {{ renderedMail.snippet }}
            </div>

            <div class="mail-viewer-body-shell mail-html-shell">
              <div class="mail-viewer-body-toolbar mail-html-toolbar">
                <span class="mail-viewer-canvas-note mail-html-note">正文内容已按安全策略清洗。</span>
                <span
                  v-if="shouldShowFolderBadge(selectedMail)"
                  class="mail-folder-badge"
                  :class="`mail-folder-badge-${selectedMail.folderKind}`"
                  :title="selectedMail.folderLabel"
                >
                  <svg v-if="selectedMail.folderKind === 'inbox'" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M3.5 6.25A1.75 1.75 0 0 1 5.25 4.5h9.5A1.75 1.75 0 0 1 16.5 6.25v7.5A1.75 1.75 0 0 1 14.75 15.5h-9.5A1.75 1.75 0 0 1 3.5 13.75z"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linejoin="round"
                    />
                    <path
                      d="m4.25 6 5.088 4.07a1 1 0 0 0 1.248 0L15.75 6"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <svg v-else viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M10 4.25 16 15.5H4z"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linejoin="round"
                    />
                    <path d="M10 8v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M10 14h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  </svg>
                  <span>{{ selectedMail.folderLabel }}</span>
                </span>
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
