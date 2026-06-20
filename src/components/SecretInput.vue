<template>
  <div
    class="secret-input"
    :class="{
      'is-secret-visible': visible,
      'is-secret-hidden': isMasked,
      'has-prefix': hasPrefix
    }"
  >
    <n-input
      :value="textValue"
      type="text"
      :size="size"
      :placeholder="placeholder"
      :input-props="inputProps"
      :disabled="disabled"
      :loading="loading"
      :clearable="clearable"
      @update:value="handleValueUpdate"
      @blur="(event) => emit('blur', event)"
      @click="(event) => emit('click', event)"
      @keydown="(event) => emit('keydown', event)"
      @keyup="(event) => emit('keyup', event)"
    >
      <template v-if="hasPrefix" #prefix>
        <slot name="prefix" />
      </template>
      <template #suffix>
        <button
          type="button"
          class="secret-input-toggle"
          :disabled="disabled || !hasValue"
          :title="visible ? '隐藏内容' : '显示内容'"
          :aria-label="visible ? '隐藏内容' : '显示内容'"
          :aria-pressed="visible"
          @mousedown.prevent
          @click.stop="visible = !visible"
        >
          <EyeOffGlyph v-if="visible" />
          <EyeGlyph v-else />
        </button>
      </template>
    </n-input>
    <span v-if="isMasked" class="secret-input-mask" aria-hidden="true">
      <span v-for="segment in maskSegments" :key="segment" class="secret-input-mask-segment" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, useSlots } from 'vue';
import { NInput } from 'naive-ui';

const props = withDefaults(
  defineProps<{
    value?: string | null;
    placeholder?: string;
    inputProps?: Record<string, unknown>;
    size?: 'tiny' | 'small' | 'medium' | 'large';
    disabled?: boolean;
    loading?: boolean;
    clearable?: boolean;
    maskText?: string;
  }>(),
  {
    value: '',
    placeholder: '',
    inputProps: undefined,
    size: 'medium',
    disabled: false,
    loading: false,
    clearable: false,
    maskText: '••••••••••'
  }
);

const emit = defineEmits<{
  'update:value': [value: string];
  blur: [event: FocusEvent];
  click: [event: MouseEvent];
  keydown: [event: KeyboardEvent];
  keyup: [event: KeyboardEvent];
}>();

const slots = useSlots();
const visible = ref(false);
const textValue = computed(() => props.value ?? '');
const hasValue = computed(() => textValue.value.length > 0);
const hasPrefix = computed(() => Boolean(slots.prefix));
const isMasked = computed(() => hasValue.value && !visible.value);
const maskSegments = [1, 2, 3, 4, 5, 6, 7, 8];

function handleValueUpdate(value: string): void {
  emit('update:value', value);
}

const EyeGlyph = () =>
  h('svg', { viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' }, [
    h('path', {
      d: 'M2.5 10s2.4-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.4 4.5-7.5 4.5S2.5 10 2.5 10Z',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }),
    h('path', {
      d: 'M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z',
      stroke: 'currentColor',
      'stroke-width': '1.5'
    })
  ]);

const EyeOffGlyph = () =>
  h('svg', { viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' }, [
    h('path', {
      d: 'M3 3l14 14',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round'
    }),
    h('path', {
      d: 'M7.4 5.9A7.9 7.9 0 0 1 10 5.5c5.1 0 7.5 4.5 7.5 4.5a11.4 11.4 0 0 1-2.1 2.6M12.1 13.8a7.9 7.9 0 0 1-2.1.3C4.9 14.1 2.5 10 2.5 10a10.9 10.9 0 0 1 2.4-2.8',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    })
  ]);
</script>

<style scoped>
.secret-input {
  position: relative;
  width: 100%;
}

.secret-input :deep(.n-input__input-el) {
  font-family: var(--font-mono);
  letter-spacing: 0;
}

.secret-input.is-secret-hidden :deep(.n-input__input-el) {
  color: transparent !important;
  caret-color: transparent;
  text-shadow: none;
  -webkit-text-fill-color: transparent;
}

.secret-input.is-secret-hidden :deep(.n-input__input-el::selection) {
  background: transparent;
  color: transparent;
}

.secret-input-mask {
  position: absolute;
  top: 50%;
  right: auto;
  left: 12px;
  display: flex;
  width: min(260px, calc(100% - 54px));
  align-items: center;
  gap: 7px;
  overflow: hidden;
  pointer-events: none;
  transform: translateY(-50%);
  white-space: nowrap;
}

.secret-input.has-prefix .secret-input-mask {
  left: 40px;
  width: min(232px, calc(100% - 82px));
}

.secret-input-mask-segment {
  display: block;
  flex: 0 0 auto;
  width: 24px;
  height: 8px;
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(100, 116, 139, 0.88), rgba(51, 65, 85, 0.88));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 0 0 1px rgba(15, 23, 42, 0.08);
}

.secret-input-mask-segment:nth-child(1) {
  width: 32px;
}

.secret-input-mask-segment:nth-child(2) {
  width: 18px;
}

.secret-input-mask-segment:nth-child(3) {
  width: 28px;
}

.secret-input-mask-segment:nth-child(4) {
  width: 22px;
}

.secret-input-mask-segment:nth-child(5) {
  width: 34px;
}

.secret-input-mask-segment:nth-child(6) {
  width: 16px;
}

.secret-input-mask-segment:nth-child(7) {
  width: 26px;
}

.secret-input-mask-segment:nth-child(8) {
  width: 20px;
}

.secret-input-toggle {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background-color 0.18s ease;
}

.secret-input-toggle:hover:not(:disabled),
.secret-input-toggle:focus-visible {
  background: #eff6ff;
  color: #2563eb;
  outline: none;
}

.secret-input-toggle:focus-visible {
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.22);
}

.secret-input-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.secret-input-toggle svg {
  width: 16px;
  height: 16px;
}
</style>
