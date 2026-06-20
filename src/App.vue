<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <RouterView />
  </n-config-provider>
</template>

<script setup lang="ts">
import { NConfigProvider, type GlobalThemeOverrides } from 'naive-ui';
import { RouterView } from 'vue-router';

const themeOverrides: GlobalThemeOverrides = {
  common: {
    fontFamily: 'var(--font-sans)',
    fontFamilyMono: 'var(--font-mono)',
    fontSize: '14px',
    fontSizeMini: '12px',
    fontSizeTiny: '12px',
    fontSizeSmall: '13px',
    fontSizeMedium: '14px',
    fontSizeLarge: '15px',
    fontSizeHuge: '18px',
    fontWeightStrong: '700',
    lineHeight: '1.5'
  },
  Button: {
    fontSizeTiny: '12px',
    fontSizeSmall: '13px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px'
  },
  Input: {
    fontSizeTiny: '12px',
    fontSizeSmall: '13px',
    fontSizeMedium: '14px',
    fontSizeLarge: '15px',
    lineHeight: '1.5',
    lineHeightTextarea: '1.6'
  },
  Select: {
    peers: {
      InternalSelection: {
        fontSizeTiny: '12px',
        fontSizeSmall: '13px',
        fontSizeMedium: '14px',
        fontSizeLarge: '15px'
      },
      InternalSelectMenu: {
        optionFontSizeTiny: '12px',
        optionFontSizeSmall: '13px',
        optionFontSizeMedium: '14px',
        optionFontSizeLarge: '15px',
        optionFontSizeHuge: '16px'
      }
    }
  },
  Form: {
    lineHeight: '1.5',
    labelFontSizeTopSmall: '13px',
    labelFontSizeTopMedium: '13px',
    labelFontSizeTopLarge: '14px',
    labelFontSizeLeftSmall: '13px',
    labelFontSizeLeftMedium: '13px',
    labelFontSizeLeftLarge: '14px',
    feedbackFontSizeSmall: '12px',
    feedbackFontSizeMedium: '12px',
    feedbackFontSizeLarge: '13px',
    labelFontWeight: '600'
  },
  DataTable: {
    fontSizeSmall: '13px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px',
    lineHeight: '1.5',
    thFontWeight: '700'
  },
  Card: {
    fontSizeSmall: '13px',
    fontSizeMedium: '14px',
    fontSizeLarge: '15px',
    fontSizeHuge: '16px',
    titleFontSizeSmall: '14px',
    titleFontSizeMedium: '16px',
    titleFontSizeLarge: '16px',
    titleFontSizeHuge: '18px',
    titleFontWeight: '700',
    lineHeight: '1.5'
  },
  Pagination: {
    itemFontSizeSmall: '12px',
    itemFontSizeMedium: '13px',
    itemFontSizeLarge: '14px',
    jumperFontSizeSmall: '12px',
    jumperFontSizeMedium: '13px',
    jumperFontSizeLarge: '14px'
  }
};
</script>
