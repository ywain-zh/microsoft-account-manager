import { h } from 'vue';

/**
 * 项目通用的复制图标，与 AccountsView.vue / CloudMailAccountsView.vue 中现有的内联定义保持一致。
 * 配合全局样式类 `table-icon-button`（src/style.css）使用。
 */
export const CopyGlyph = () =>
  h(
    'svg',
    { viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
    [
      h('path', {
        d: 'M7 7.75A1.75 1.75 0 0 1 8.75 6h6.5A1.75 1.75 0 0 1 17 7.75v6.5A1.75 1.75 0 0 1 15.25 16h-6.5A1.75 1.75 0 0 1 7 14.25z',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linejoin': 'round'
      }),
      h('path', {
        d: 'M4.75 13.25A1.75 1.75 0 0 1 3 11.5V5.25A1.75 1.75 0 0 1 4.75 3.5H11A1.75 1.75 0 0 1 12.75 5.25',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round'
      })
    ]
  );
