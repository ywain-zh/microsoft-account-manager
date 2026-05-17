export interface ConsoleNavItem {
  key: string;
  label: string;
  path: string;
}

export const defaultConsoleRoute = '/services/cloud-mail/accounts';

export const consoleNavigation: ConsoleNavItem[] = [
  {
    key: 'cloud-mail',
    label: 'Cloud Mail',
    path: '/services/cloud-mail/accounts'
  },
  {
    key: 'microsoft-mail',
    label: '微软邮箱',
    path: '/services/microsoft-mail/accounts'
  },
  {
    key: 'sub2api',
    label: 'Sub2API 检测',
    path: '/services/sub2api/checker'
  },
  {
    key: 'sub2api-codex-login',
    label: 'Codex Login',
    path: '/services/sub2api/codex-login'
  },
  {
    key: 'system-settings',
    label: '系统设置',
    path: '/services/system/settings'
  }
];
