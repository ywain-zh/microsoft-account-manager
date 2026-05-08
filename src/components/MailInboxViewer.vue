<template>
  <AppModal
    :show="show"
    card-class="inbox-modal-card"
    width="min(1120px, 96vw)"
    height="85vh"
    :closable="false"
    :content-style="{ padding: 0, height: '100%', minHeight: 0, overflow: 'hidden' }"
    @update:show="handleShowUpdate"
  >
    <div class="inbox-modal-layout">
      <div class="modal-header">
        <div class="modal-header-left">
          <h2>{{ title }}</h2>
          <div class="email-action-group">
            <p class="current-email">{{ account || '-' }}</p>
            <button
              class="btn-small-action"
              type="button"
              title="复制邮箱"
              aria-label="复制邮箱"
              :disabled="!account || copyLoading"
              :class="{ 'btn-small-action-success': copyFeedbackVisible }"
              @click.stop.prevent="handleCopy"
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
              <span>{{ copyFeedbackVisible ? '已复制' : '复制' }}</span>
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
        <button class="btn-close" type="button" aria-label="关闭收件箱" @click="handleShowUpdate(false)">
          ×
        </button>
      </div>

      <div class="inbox-split-view">
        <aside class="inbox-sider">
          <n-spin :show="loading" class="inbox-spin">
            <div v-if="items.length === 0" class="inbox-empty-state inbox-empty-state-sider">
              <n-empty description="暂无邮件" />
            </div>

            <div v-else class="inbox-list">
              <button
                v-for="item in items"
                :key="item.id"
                class="inbox-mail-item"
                :class="{
                  active: selectedMailId === item.id,
                  'inbox-mail-item-unread': item.isRead === false,
                  'inbox-mail-item-read': item.isRead === true,
                  'inbox-mail-item-neutral': item.isRead === null
                }"
                type="button"
                @click="emit('select', item.id)"
              >
                <div class="mail-item-topline">
                  <div class="mail-sender-wrap">
                    <span v-if="item.isRead === false" class="mail-unread-dot" aria-hidden="true"></span>
                    <div class="mail-sender" :title="item.from || '未知发件人'">{{ item.from || '未知发件人' }}</div>
                  </div>
                  <div class="mail-date">{{ formatDate(item.receivedAt) }}</div>
                </div>
                <div class="mail-item-badges">
                  <span class="mail-folder-badge" :class="`mail-folder-badge-${item.folderKind}`">
                    {{ item.folderLabel }}
                  </span>
                  <span v-if="item.isRead === false" class="mail-state-badge mail-state-badge-unread">未读</span>
                  <span v-else-if="item.isRead === true" class="mail-state-badge mail-state-badge-read">已读</span>
                </div>
                <div class="mail-subject" :title="item.subject || '(无主题)'">{{ item.subject || '(无主题)' }}</div>
                <div class="mail-snippet" :title="resolveSnippet(item)">
                  {{ resolveSnippet(item) || '暂无邮件摘要' }}
                </div>
              </button>
            </div>
          </n-spin>
        </aside>

        <section class="inbox-content">
          <div v-if="!selectedMail" class="inbox-empty-state">
            请选择一封邮件进行阅读
          </div>

          <div v-else class="mail-detail-container">
            <div class="mail-detail-header">
              <div class="mail-detail-subject">{{ selectedMail.subject || '(无主题)' }}</div>
              <div class="mail-meta-info">
                <div><strong>发件人:</strong> {{ selectedMail.from || '-' }}</div>
                <div><strong>时 间:</strong> {{ formatDate(selectedMail.receivedAt) }}</div>
              </div>
            </div>

            <div v-if="translationBannerVisible" class="translation-banner">
              <div class="translation-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4.75 5.75h7.5M8.5 4.25v1.5M12 5.75c-.62 2.38-2.28 4.57-5.25 6.5"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.8"
                  />
                  <path
                    d="M6.25 8.25c1.02 1.8 2.48 3.18 4.25 4"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.8"
                  />
                  <path
                    d="M13 19.75l3.5-8.5 3.5 8.5M14.25 16.75h4.5"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.8"
                  />
                </svg>
              </div>
              <div class="translation-copy">
                <div class="translation-title">
                  {{ translationVisible && translatedEntry ? '已翻译为中文' : '此邮件似乎不是中文' }}
                </div>
                <div v-if="translationVisible && translatedEntry" class="translation-meta">
                  {{ resolveTranslationProviderLabel(translatedEntry) }}
                </div>
                <div v-else-if="translationError" class="translation-error">{{ translationError }}</div>
              </div>
              <div class="translation-actions">
                <button
                  v-if="translatedEntry"
                  class="translation-button translation-button-secondary"
                  type="button"
                  @click="translationVisible = !translationVisible"
                >
                  {{ translationVisible ? '查看原文' : '查看译文' }}
                </button>
                <button
                  class="translation-button translation-button-primary"
                  type="button"
                  :disabled="translationLoading"
                  @click="handleTranslate"
                >
                  {{ translationLoading ? '翻译中...' : translatedEntry ? '重新翻译' : '翻译成中文' }}
                </button>
              </div>
            </div>

            <div class="mail-html-body">
              <iframe
                ref="mailFrameRef"
                class="mail-html-frame"
                :title="selectedMail.subject || '邮件正文'"
                :srcdoc="renderedMail.srcdoc"
                :style="{ height: `${mailFrameHeight}px` }"
                scrolling="auto"
                sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                referrerpolicy="no-referrer"
                @load="resizeMailFrame"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NEmpty, NSpin } from 'naive-ui';
import { api } from '../api';
import type { AccountMailItem, TranslationResponse } from '../types';
import {
  buildMailPreview,
  buildMailTranslationSource,
  buildTranslatedMail,
  defaultMailFrameHeight,
  extractMailSnippet,
  extractMailText,
  maxMailFrameHeight
} from '../utils/mail-preview';

type TranslationCacheEntry = Pick<TranslationResponse, 'provider' | 'model' | 'translatedText'>;

interface MailInboxViewerProps {
  show: boolean;
  title: string;
  account: string;
  items: AccountMailItem[];
  loading: boolean;
  selectedMailId: string;
  formatDate: (value: string) => string;
  onCopy?: () => boolean | Promise<boolean>;
}

const props = defineProps<MailInboxViewerProps>();

const emit = defineEmits<{
  (event: 'update:show', value: boolean): void;
  (event: 'select', id: string): void;
  (event: 'refresh'): void;
}>();

const selectedMail = computed(() => {
  return props.items.find((item) => item.id === props.selectedMailId) ?? null;
});

const selectedMailKey = computed(() => selectedMail.value?.id ?? '');
const translationCache = ref<Record<string, TranslationCacheEntry>>({});
const translationLoading = ref(false);
const translationError = ref('');
const translationVisible = ref(false);
const translatedEntry = computed(() => {
  const key = selectedMailKey.value;
  return key ? translationCache.value[key] ?? null : null;
});
const mailTranslationSource = computed(() => buildMailTranslationSource(selectedMail.value));
const mailTextForLanguageDetection = computed(() => extractMailText(selectedMail.value));
const mailTextForTranslation = computed(() => mailTranslationSource.value.text);
const shouldOfferTranslation = computed(() => isProbablyNonChineseText(mailTextForLanguageDetection.value));
const translationBannerVisible = computed(() => {
  return Boolean(
    selectedMail.value &&
      (shouldOfferTranslation.value || translatedEntry.value || translationError.value || translationLoading.value)
  );
});
const displayedMail = computed<AccountMailItem | null>(() => {
  if (!selectedMail.value || !translatedEntry.value || !translationVisible.value) {
    return selectedMail.value;
  }

  return buildTranslatedMail(selectedMail.value, translatedEntry.value.translatedText);
});
const renderedMail = computed(() => buildMailPreview(displayedMail.value));
const mailFrameRef = ref<HTMLIFrameElement | null>(null);
const mailFrameHeight = ref(defaultMailFrameHeight);
const copyFeedbackVisible = ref(false);
const copyLoading = ref(false);
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.show,
  (visible) => {
    if (!visible) {
      resetCopyFeedback();
      resetTranslationFeedback();
    }
  }
);

watch(selectedMailKey, (key) => {
  translationLoading.value = false;
  translationError.value = '';
  translationVisible.value = Boolean(key && translationCache.value[key]);
});

watch(
  () => renderedMail.value.srcdoc,
  () => {
    mailFrameHeight.value = defaultMailFrameHeight;
  }
);

function resolveSnippet(item: AccountMailItem): string {
  return extractMailSnippet(item);
}

function handleShowUpdate(value: boolean): void {
  emit('update:show', value);
}

async function handleCopy(): Promise<void> {
  if (copyLoading.value || !props.onCopy) {
    return;
  }

  copyLoading.value = true;

  try {
    const copied = await props.onCopy();
    if (!copied) {
      resetCopyFeedback();
      return;
    }

    copyFeedbackVisible.value = true;
    if (copyFeedbackTimer) {
      clearTimeout(copyFeedbackTimer);
    }
    copyFeedbackTimer = setTimeout(() => {
      copyFeedbackVisible.value = false;
      copyFeedbackTimer = null;
    }, 2000);
  } finally {
    copyLoading.value = false;
  }
}

async function handleTranslate(): Promise<void> {
  const key = selectedMailKey.value;
  const text = mailTextForTranslation.value;
  if (!key || !text || translationLoading.value) {
    return;
  }

  translationLoading.value = true;
  translationError.value = '';

  try {
    const result = await api.translateMailText({ text });
    translationCache.value = {
      ...translationCache.value,
      [key]: result
    };
    translationVisible.value = true;
  } catch (error) {
    translationError.value = error instanceof Error ? error.message : '翻译失败';
  } finally {
    translationLoading.value = false;
  }
}

function resetTranslationFeedback(): void {
  translationLoading.value = false;
  translationError.value = '';
}

function resizeMailFrame(): void {
  const frame = mailFrameRef.value;
  if (!frame) {
    return;
  }

  window.requestAnimationFrame(() => {
    const doc = frame.contentDocument;
    if (!doc) {
      return;
    }

    const html = doc.documentElement;
    const body = doc.body;
    const contentHeight = Math.max(
      html?.scrollHeight ?? 0,
      body?.scrollHeight ?? 0,
      html?.offsetHeight ?? 0,
      body?.offsetHeight ?? 0,
      defaultMailFrameHeight
    );
    mailFrameHeight.value = Math.min(Math.max(contentHeight, defaultMailFrameHeight), maxMailFrameHeight);
  });
}

function resolveTranslationProviderLabel(entry: TranslationCacheEntry): string {
  if (entry.provider === 'openai') {
    return entry.model ? `OpenAI · ${entry.model}` : 'OpenAI';
  }
  return 'DeepLX';
}

function isProbablyNonChineseText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < 24) {
    return false;
  }

  const chineseCount = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  if (chineseCount >= 8) {
    return false;
  }

  const letterCount = (normalized.match(/[A-Za-zÀ-ÖØ-öø-ÿĀ-žА-яЁё]/g) ?? []).length;
  if (letterCount < 8) {
    return false;
  }

  return chineseCount / Math.max(letterCount, 1) < 0.2;
}

function resetCopyFeedback(): void {
  copyFeedbackVisible.value = false;
  copyLoading.value = false;
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = null;
  }
}

onBeforeUnmount(() => {
  resetCopyFeedback();
});
</script>

<style scoped>
:deep(.inbox-modal-card) {
  display: flex;
  flex-direction: column;
  border: 0 !important;
  border-radius: 20px !important;
  background:
    radial-gradient(circle at 8% 0%, rgba(168, 85, 247, 0.1), transparent 30%),
    radial-gradient(circle at 98% 5%, rgba(6, 182, 212, 0.12), transparent 36%),
    rgba(255, 255, 255, 0.9) !important;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.2) !important;
  backdrop-filter: blur(24px);
}

:deep(.inbox-modal-card > .n-card__content),
:deep(.inbox-modal-card .app-modal-body) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

:deep(.inbox-modal-card .app-modal-body) {
  overflow: hidden;
}

:deep(.inbox-modal-card) {
  overflow: hidden;
}

.inbox-modal-layout {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.44));
  flex-shrink: 0;
}

.modal-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
}

.modal-header-left h2 {
  margin: 0;
  color: #1e293b;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
}

.email-action-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.current-email {
  margin: 0;
  min-width: 0;
  max-width: min(38vw, 360px);
  color: #64748b;
  font-size: 14px;
  line-height: 1.4;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-small-action,
.btn-close {
  font: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-small-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-size: 12px;
  line-height: 1;
}

.btn-small-action:hover:not(:disabled) {
  background: #f4f6f8;
  border-color: #409eff;
  color: #409eff;
}

.btn-small-action:active:not(:disabled) {
  background: #ecf5ff;
}

.btn-small-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.btn-small-action-success {
  color: #047857;
  border-color: #047857;
}

.btn-small-action-success:hover:not(:disabled) {
  background: #f0fdf4;
  border-color: #047857;
  color: #047857;
}

.btn-small-action svg {
  width: 14px;
  height: 14px;
  flex: none;
}

.btn-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  font-size: 24px;
  line-height: 1;
  flex: none;
}

.btn-close:hover {
  background: #f1f5f9;
  color: #f56c6c;
}

.spin {
  animation: inbox-modal-spin 1s linear infinite;
}

@keyframes inbox-modal-spin {
  100% {
    transform: rotate(360deg);
  }
}

.inbox-split-view {
  display: grid;
  grid-template-columns: clamp(260px, 27%, 300px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.58);
}

.inbox-sider {
  display: flex;
  flex-direction: column;
  width: auto;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: rgba(248, 250, 252, 0.7);
  border-right: 0;
  box-shadow: 12px 0 32px rgba(15, 23, 42, 0.04);
}

.inbox-spin,
:deep(.inbox-spin .n-spin-container),
:deep(.inbox-spin .n-spin-content) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.inbox-list {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  padding: 12px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.inbox-mail-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin: 0 0 10px;
  padding: 14px 14px 12px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease,
    transform 0.2s ease;
}

.inbox-mail-item:hover {
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

.inbox-mail-item.active {
  background: linear-gradient(180deg, #eff6ff 0%, #ecf5ff 100%);
  box-shadow: none;
}

.inbox-mail-item-unread {
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
}

.inbox-mail-item-read,
.inbox-mail-item-neutral {
  background: #ffffff;
}

.mail-item-topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.mail-sender-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mail-unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #409eff;
  flex: none;
  box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.12);
}

.mail-sender {
  min-width: 0;
  margin: 0;
  color: #334155;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inbox-mail-item-unread .mail-sender,
.inbox-mail-item.active .mail-sender {
  color: #0f172a;
  font-weight: 600;
}

.mail-date {
  margin: 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  text-align: right;
  flex: none;
}

.mail-item-badges,
.mail-folder-badge,
.mail-state-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.mail-folder-badge-inbox {
  background: #eff6ff;
  color: #2563eb;
}

.mail-folder-badge-junk {
  background: #fff7ed;
  color: #ea580c;
}

.mail-state-badge-unread {
  background: #dbeafe;
  color: #1d4ed8;
}

.mail-state-badge-read {
  background: #f1f5f9;
  color: #64748b;
}

.mail-subject {
  min-width: 0;
  margin: 0;
  color: #1e293b;
  font-size: 13px;
  line-height: 1.5;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inbox-mail-item-read .mail-subject,
.inbox-mail-item-neutral .mail-subject {
  color: #334155;
}

.mail-snippet {
  display: -webkit-box;
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.55;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.inbox-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;
  padding: 14px 18px 18px;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.mail-detail-container {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.mail-detail-header {
  flex: none;
  padding: 6px 2px 2px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.mail-detail-subject {
  margin: 0;
  max-width: 100%;
  color: #1e293b;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.32;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-meta-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
}

.mail-meta-info div {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-meta-info strong {
  margin-right: 8px;
  color: #334155;
  font-weight: 600;
}

.translation-banner {
  display: flex;
  align-items: center;
  flex: none;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  background: #f8fbff;
  box-shadow: 0 8px 18px rgba(59, 130, 246, 0.06);
}

.translation-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: #eff6ff;
  color: #2563eb;
  flex: none;
}

.translation-icon svg {
  width: 19px;
  height: 19px;
}

.translation-copy {
  min-width: 0;
}

.translation-title {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

.translation-meta,
.translation-error {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
}

.translation-meta {
  color: #64748b;
}

.translation-error {
  color: #dc2626;
}

.translation-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex: none;
}

.translation-button {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, opacity 0.2s ease;
}

.translation-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.translation-button-primary {
  border: 1px solid #2563eb;
  background: #2563eb;
  color: #ffffff;
}

.translation-button-primary:hover:not(:disabled) {
  border-color: #1d4ed8;
  background: #1d4ed8;
}

.translation-button-secondary {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
}

.translation-button-secondary:hover:not(:disabled) {
  border-color: #93c5fd;
  color: #2563eb;
}

.mail-html-body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  height: auto;
  display: flex;
  align-items: stretch;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  background: linear-gradient(180deg, #f8fafc 0%, #eef4fb 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.mail-html-frame {
  display: block;
  flex: none;
  width: 100%;
  height: auto;
  min-height: 100%;
  overflow: auto;
  border: 0;
  border-radius: 14px;
  background: transparent;
}

.inbox-empty-state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 24px;
  color: #64748b;
  text-align: center;
}

.inbox-empty-state-sider {
  background: #f8fafc;
}

:deep(.inbox-empty-state .n-empty__description) {
  color: #64748b;
}

.inbox-split-view ::-webkit-scrollbar,
.inbox-content::-webkit-scrollbar,
.inbox-list::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.inbox-split-view ::-webkit-scrollbar-thumb,
.inbox-content::-webkit-scrollbar-thumb,
.inbox-list::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.inbox-split-view ::-webkit-scrollbar-track,
.inbox-content::-webkit-scrollbar-track,
.inbox-list::-webkit-scrollbar-track {
  background: transparent;
}

@media (max-width: 768px) {
  .inbox-modal-card {
    width: calc(100vw - 24px) !important;
    max-width: none !important;
    height: calc(100vh - 24px) !important;
    max-height: calc(100vh - 24px) !important;
  }

  .modal-header {
    padding: 16px 20px;
  }

  .modal-header-left {
    align-items: flex-start;
  }

  .inbox-split-view {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(180px, 320px) minmax(0, 1fr);
  }

  .inbox-sider {
    width: 100%;
    min-width: 0;
    height: 100%;
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid #f1f5f9;
  }

  .inbox-content {
    padding: 18px;
  }

  .translation-banner {
    align-items: flex-start;
    flex-direction: column;
  }

  .translation-actions {
    width: 100%;
    margin-left: 0;
    flex-wrap: wrap;
  }

  .translation-button {
    flex: 1;
    min-width: 120px;
  }

  .mail-detail-header,
  .mail-html-body {
    padding-left: 14px;
    padding-right: 14px;
  }
}

@media (max-width: 640px) {
  .inbox-modal-card {
    width: calc(100vw - 16px) !important;
    max-width: none !important;
    height: calc(100vh - 16px) !important;
    max-height: calc(100vh - 16px) !important;
  }

  .modal-header {
    align-items: flex-start;
    padding: 14px 16px;
  }

  .modal-header-left {
    gap: 12px;
    flex-direction: column;
  }

  .email-action-group {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .inbox-content {
    padding: 16px;
  }

  .mail-item-topline {
    flex-direction: column;
    align-items: flex-start;
  }

  .mail-detail-subject {
    font-size: 18px;
    white-space: normal;
  }

  .mail-meta-info {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
}
</style>
