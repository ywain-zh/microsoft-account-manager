/// <reference types="vite/client" />
import type { DefineComponent } from 'vue';
import 'vue-router';

declare module '*.vue' {
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
    title?: string;
    description?: string;
    groupKey?: string;
  }
}

export {};
