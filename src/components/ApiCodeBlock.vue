<template>
  <div class="api-code-block">
    <div class="api-code-head">
      <span>{{ languageLabel }}</span>
      <button
        class="api-code-copy"
        type="button"
        :title="copied ? '已复制' : '复制代码'"
        :aria-label="copied ? '已复制代码' : '复制代码'"
        @click="copyCode"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 7a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V7Z" />
          <path d="M5 15H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </div>
    <pre><code>{{ codeText }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { copyToClipboard } from '../utils/clipboard';

const props = defineProps<{
  code: string;
  language?: string;
}>();

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const codeText = computed(() => String(props.code ?? ''));
const languageLabel = computed(() => props.language?.toUpperCase() || 'CODE');

async function copyCode(): Promise<void> {
  const ok = await copyToClipboard(codeText.value);
  if (!ok) {
    return;
  }

  copied.value = true;
  if (copiedTimer) {
    clearTimeout(copiedTimer);
  }
  copiedTimer = setTimeout(() => {
    copied.value = false;
    copiedTimer = null;
  }, 1600);
}

onBeforeUnmount(() => {
  if (copiedTimer) {
    clearTimeout(copiedTimer);
  }
});
</script>

<style scoped>
.api-code-block {
  position: relative;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
}

.api-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid #e5e7eb;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.api-code-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  color: #64748b;
  cursor: pointer;
}

.api-code-copy:hover {
  border-color: #93c5fd;
  color: #2563eb;
}

.api-code-copy svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.api-code-block pre {
  max-height: 520px;
  margin: 0;
  overflow: auto;
  padding: 18px 22px;
  color: #0f172a;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
