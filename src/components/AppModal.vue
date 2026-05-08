<template>
  <n-modal
    :show="show"
    class="app-modal"
    :mask-closable="maskClosable"
    :close-on-esc="closeOnEsc"
    @update:show="handleShowUpdate"
  >
    <n-card
      class="app-modal-card"
      :class="[cardClass, `app-modal-card-${size}`]"
      :bordered="false"
      size="small"
      role="dialog"
      aria-modal="true"
      :style="cardStyle"
      content-style="padding: 0;"
      @click.stop
    >
      <header v-if="title || closable" class="app-modal-header">
        <h2 v-if="title" class="app-modal-title">{{ title }}</h2>
        <button
          v-if="closable"
          class="app-modal-close"
          type="button"
          aria-label="关闭"
          @click="close"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div class="app-modal-body" :style="contentStyle">
        <slot />
      </div>

      <footer v-if="$slots.footer" class="app-modal-footer">
        <slot name="footer" />
      </footer>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NCard, NModal } from 'naive-ui';

type AppModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const props = withDefaults(
  defineProps<{
    show: boolean;
    title?: string;
    size?: AppModalSize;
    width?: string;
    height?: string;
    contentStyle?: string | Record<string, string | number>;
    cardClass?: string;
    closable?: boolean;
    maskClosable?: boolean;
    closeOnEsc?: boolean;
  }>(),
  {
    size: 'md',
    closable: true,
    maskClosable: true,
    closeOnEsc: true,
  },
);

const emit = defineEmits<{
  'update:show': [value: boolean];
}>();

const widthBySize: Record<AppModalSize, string> = {
  sm: 'min(520px, 92vw)',
  md: 'min(680px, 92vw)',
  lg: 'min(920px, 94vw)',
  xl: 'min(1120px, 96vw)',
  full: 'min(1280px, 96vw)',
};

const cardStyle = computed(() => {
  const style: Record<string, string> = {
    width: props.width || widthBySize[props.size],
  };

  if (props.height) {
    style.height = props.height;
  }

  return style;
});

function handleShowUpdate(value: boolean) {
  emit('update:show', value);
}

function close() {
  emit('update:show', false);
}
</script>
