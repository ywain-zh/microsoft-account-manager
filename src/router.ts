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
        description: '登录望月工具箱，进入管理台。'
      }
    },
    {
      path: '/share/cloud-mail/:token',
      name: 'cloud-mail-share',
      component: () => import('./views/CloudMailShareView.vue'),
      meta: {
        title: 'Cloud Mail 共享收件箱',
        description: '通过分享链接只读查看 Cloud Mail 收件箱。'
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
          path: 'services/cloud-mail/accounts',
          name: 'cloud-mail-accounts',
          component: () => import('./views/CloudMailAccountsView.vue'),
          meta: {
            requiresAuth: true,
            title: 'Cloud Mail',
            description: '查看、创建和删除 Cloud Mail 邮箱账号，并维护远端服务配置。'
          }
        },
        {
          path: 'services/sub2api/checker',
          name: 'sub2api-checker',
          component: () => import('./views/Sub2ApiCheckerView.vue'),
          meta: {
            requiresAuth: true,
            title: 'Sub2API 检测',
            description: '使用管理员 API Key 批量检测 Sub2API 账号并查看实时日志。'
          }
        },
        {
          path: 'services/sub2api/long-link-generator',
          name: 'sub2api-long-link-generator',
          component: () => import('./views/Sub2ApiLongLinkGeneratorView.vue'),
          meta: {
            requiresAuth: true,
            title: '长链生成器',
            description: '使用 ChatGPT accessToken 生成 pay.openai.com 支付长链，并支持专用代理池。'
          }
        },
        {
          path: 'services/sub2api/interfaces',
          name: 'sub2api-interfaces',
          component: () => import('./views/InterfacesView.vue'),
          meta: {
            requiresAuth: true,
            title: '接口文档',
            description: '查看外部接口调用方式、鉴权 Header 和请求示例。'
          }
        },
        {
          path: 'services/system/settings',
          name: 'system-settings',
          component: () => import('./views/SystemSettingsView.vue'),
          meta: {
            requiresAuth: true,
            title: '系统设置',
            description: '维护翻译服务配置。'
          }
        },
        {
          path: 'services/microsoft-mail/accounts',
          name: 'microsoft-mail-accounts',
          component: () => import('./views/AccountsView.vue'),
          meta: {
            requiresAuth: true,
            title: '微软邮箱',
            description: '查看、导入和维护微软邮箱账号，并执行批量刷新和取件。'
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

  if (!isProtected && !isGuestOnly) {
    return true;
  }

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
