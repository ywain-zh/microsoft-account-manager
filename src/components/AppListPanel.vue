<template>
  <section class="app-list-panel" :class="`app-list-panel-${tone}`">
    <div v-if="$slots.toolbar" class="app-list-panel-toolbar">
      <slot name="toolbar" />
    </div>

    <div class="app-list-panel-body">
      <slot />
    </div>

    <div v-if="$slots.footer" class="app-list-panel-footer">
      <slot name="footer" />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'default' | 'compact' | 'roomy';
  }>(),
  {
    tone: 'default',
  },
);
</script>
