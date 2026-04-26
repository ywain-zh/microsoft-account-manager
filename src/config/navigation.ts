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
    key: '779-cards',
    label: '779验卡',
    path: '/services/779/cards'
  },
  {
    key: 'sub2api',
    label: 'Sub2API 检测',
    path: '/services/sub2api/checker'
  },
  {
    key: 'microsoft-mail',
    label: '微软邮箱',
    path: '/services/microsoft-mail/accounts'
  }
];
