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
    key: 'linuxdo-mail',
    label: 'Linux DO 邮箱',
    path: '/services/linuxdo-mail'
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
    key: 'public-checkin',
    label: '公益站签到',
    path: '/services/sub2api/public-checkin'
  },
  {
    key: 'sub2api-interfaces',
    label: '接口文档',
    path: '/services/sub2api/interfaces'
  },
  {
    key: 'system-settings',
    label: '系统设置',
    path: '/services/system/settings'
  }
];
