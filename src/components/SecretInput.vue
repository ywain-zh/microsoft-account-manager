<template>
  <div
    class="secret-input"
    :class="{
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
    </n-input>
  </div>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue';
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
const textValue = computed(() => props.value ?? '');
const hasPrefix = computed(() => Boolean(slots.prefix));

function handleValueUpdate(value: string): void {
  emit('update:value', value);
}
</script>

<style scoped>
.secret-input {
  position: relative;
  width: 100%;
}

.secret-input :deep(.n-input__input-el) {
  font-family: var(--font-mono);
  letter-spacing: 0;
  color: #0f172a;
}
</style>
