import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';
import { defaultConsoleRoute } from './config/navigation';
import { useAdminConsole } from './state/admin-console';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: defaultConsoleRoute
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: {
        guestOnly: true,
        title: '登录',
        description: '登录邮箱管理台，进入邮箱列表和接口管理。'
      }
    },
    {
      path: '/',
      component: () => import('./layouts/AdminShell.vue'),
      meta: {
        requiresAuth: true
      },
      children: [
        {
          path: 'services/microsoft-mail/accounts',
          name: 'microsoft-mail-accounts',
          component: () => import('./views/AccountsView.vue'),
          meta: {
            requiresAuth: true,
            title: '邮箱列表',
            description: '查看、导入和维护微软邮箱账号，并执行批量刷新和取件。',
            groupKey: 'microsoft-mail'
          }
        },
        {
          path: 'services/microsoft-mail/interfaces',
          name: 'microsoft-mail-interfaces',
          component: () => import('./views/InterfacesView.vue'),
          meta: {
            requiresAuth: true,
            title: '接口管理',
            description: '维护外部上传映射配置，并展示开放 API 与管理端接口文档。',
            groupKey: 'microsoft-mail'
          }
        }
      ]
    }
  ]
});

router.beforeEach(async (to: RouteLocationNormalized) => {
  const admin = useAdminConsole();
  const isProtected = to.matched.some((record) => record.meta.requiresAuth);
  const isGuestOnly = to.matched.some((record) => record.meta.guestOnly);

  const authenticated = await admin.ensureAuthState();

  if (isProtected && !authenticated) {
    return {
      path: '/login',
      query: { redirect: to.fullPath }
    };
  }

  if (isGuestOnly && authenticated) {
    const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : defaultConsoleRoute;
    return redirect || defaultConsoleRoute;
  }

  return true;
});

export { router };
