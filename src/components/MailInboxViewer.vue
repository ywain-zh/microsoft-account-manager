<template>
  <n-modal :show="show" class="inbox-modal" @update:show="handleShowUpdate">
    <n-card
      class="inbox-modal-card"
      :bordered="false"
      size="small"
      role="dialog"
      aria-modal="true"
      style="width: 1000px; max-width: 95vw; height: 85vh; max-height: 90vh;"
      content-style="padding: 0; display: flex; flex-direction: column; height: 100%; overflow: hidden;"
      @click.stop
    >
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
              <div class="mail-detail-header-topline">
                <div class="mail-detail-subject">{{ selectedMail.subject || '(无主题)' }}</div>
                <div class="mail-detail-badges">
                  <span class="mail-folder-badge" :class="`mail-folder-badge-${selectedMail.folderKind}`">
                    {{ selectedMail.folderLabel }}
                  </span>
                  <span v-if="selectedMail.isRead === false" class="mail-state-badge mail-state-badge-unread">未读</span>
                  <span v-else-if="selectedMail.isRead === true" class="mail-state-badge mail-state-badge-read">已读</span>
                </div>
              </div>
              <div class="mail-meta-info">
                <div><strong>发件人:</strong> {{ selectedMail.from || '-' }}</div>
                <div><strong>收件人:</strong> {{ account || '-' }}</div>
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
                class="mail-html-frame"
                :title="selectedMail.subject || '邮件正文'"
                :srcdoc="renderedMail.srcdoc"
                sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                referrerpolicy="no-referrer"
              />
            </div>
          </div>
        </section>
      </div>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NCard, NEmpty, NModal, NSpin } from 'naive-ui';
import { api } from '../api';
import type { AccountMailItem, TranslationResponse } from '../types';
import { buildMailPreview, extractMailSnippet, extractMailText } from '../utils/mail-preview';

type TranslationCacheEntry = Pick<TranslationResponse, 'provider' | 'model' | 'translatedText' | 'translatedHtml'>;
const HTML_TRANSLATION_MAX_MARKUP_LENGTH = 6000;
const HTML_TRANSLATION_MAX_TEXT_RATIO = 3;

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
const mailTextForTranslation = computed(() => extractMailText(selectedMail.value));
const shouldOfferTranslation = computed(() => isProbablyNonChineseText(mailTextForTranslation.value));
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

  if (translatedEntry.value.translatedHtml) {
    return {
      ...selectedMail.value,
      contentType: 'text/html',
      content: translatedEntry.value.translatedHtml,
      preview: translatedEntry.value.translatedText
    };
  }

  return {
    ...selectedMail.value,
    contentType: 'text/plain',
    content: translatedEntry.value.translatedText,
    preview: translatedEntry.value.translatedText
  };
});
const renderedMail = computed(() => buildMailPreview(displayedMail.value));
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
    const result = await translateSelectedMail(text);
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

async function translateSelectedMail(text: string): Promise<TranslationResponse> {
  const mail = selectedMail.value;
  const content = mail?.content?.trim() ?? '';
  if (mail && content && shouldTranslateHtmlMail(mail.contentType, content, text)) {
    return api.translateMailHtml({ html: content, text });
  }

  return api.translateMailText({ text });
}

function shouldTranslateHtmlMail(contentType: string | null | undefined, content: string, text: string): boolean {
  if (!isHtmlContent(contentType, content)) {
    return false;
  }

  const normalizedTextLength = text.trim().length;
  if (content.length > HTML_TRANSLATION_MAX_MARKUP_LENGTH) {
    return false;
  }

  if (normalizedTextLength > 0 && content.length / normalizedTextLength > HTML_TRANSLATION_MAX_TEXT_RATIO) {
    return false;
  }

  return true;
}

function isHtmlContent(contentType: string | null | undefined, content: string): boolean {
  const normalized = (contentType ?? '').trim().toLowerCase();
  if (normalized.includes('html')) {
    return true;
  }
  if (normalized.includes('plain')) {
    return false;
  }
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

function resetTranslationFeedback(): void {
  translationLoading.value = false;
  translationError.value = '';
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
:deep(.inbox-modal) {
  width: auto !important;
  max-width: none !important;
}

:deep(.inbox-modal .n-card) {
  border-radius: 12px !important;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15) !important;
}

.inbox-modal-card {
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid #f1f5f9;
  background: #ffffff;
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
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #ffffff;
}

.inbox-sider {
  display: flex;
  flex-direction: column;
  width: 320px;
  min-width: 300px;
  min-height: 0;
  background: #f8fafc;
  border-right: 1px solid #f1f5f9;
}

.inbox-spin,
:deep(.inbox-spin .n-spin-content) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.inbox-list {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  overflow-x: hidden;
}

.inbox-mail-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin: 0 0 10px;
  padding: 14px 14px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease,
    transform 0.2s ease;
}

.inbox-mail-item:hover {
  border-color: #dbeafe;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

.inbox-mail-item.active {
  border-color: #409eff;
  background: linear-gradient(180deg, #eff6ff 0%, #ecf5ff 100%);
  box-shadow: none;
}

.inbox-mail-item-unread {
  border-color: rgba(64, 158, 255, 0.14);
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
.mail-detail-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

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
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 24px;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.mail-detail-container {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
  min-height: 0;
}

.mail-detail-header {
  padding: 24px 28px;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.06);
}

.mail-detail-header-topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.mail-detail-subject {
  margin: 0;
  color: #1e293b;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.4;
}

.mail-meta-info {
  display: grid;
  gap: 2px;
  color: #475569;
  font-size: 13px;
  line-height: 2;
}

.mail-meta-info strong {
  display: inline-block;
  width: 60px;
  color: #1e293b;
  font-weight: 600;
}

.translation-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #dbeafe;
  border-radius: 14px;
  background: #f8fbff;
  box-shadow: 0 8px 22px rgba(59, 130, 246, 0.08);
}

.translation-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #eff6ff;
  color: #2563eb;
  flex: none;
}

.translation-icon svg {
  width: 22px;
  height: 22px;
}

.translation-copy {
  min-width: 0;
}

.translation-title {
  color: #0f172a;
  font-size: 14px;
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
  min-height: 34px;
  padding: 0 13px;
  border-radius: 7px;
  font: inherit;
  font-size: 13px;
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
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  background: linear-gradient(180deg, #f8fafc 0%, #eef4fb 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.mail-html-frame {
  display: block;
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
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
    flex-direction: column;
  }

  .inbox-sider {
    width: 100%;
    min-width: 0;
    max-height: 320px;
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
    padding-left: 18px;
    padding-right: 18px;
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

  .mail-item-topline,
  .mail-detail-header-topline {
    flex-direction: column;
    align-items: flex-start;
  }

  .mail-detail-subject {
    font-size: 20px;
  }
}
</style>
