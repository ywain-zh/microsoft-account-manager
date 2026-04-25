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
        description: '登录邮箱管理台，进入邮箱列表。'
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
          path: 'services/779/cards',
          name: '779-cards',
          component: () => import('./views/Seven79CardsView.vue'),
          meta: {
            requiresAuth: true,
            title: '779验卡',
            description: '导入 779 卡密，批量校验并提取卡片信息。'
          }
        },
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
          path: 'services/stripe/payment',
          name: 'stripe-payment',
          component: () => import('./views/StripePaymentView.vue'),
          meta: {
            requiresAuth: true,
            title: 'Stripe支付',
            description: '通过 pay.py 执行 Stripe Checkout 自动化支付脚本。'
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
