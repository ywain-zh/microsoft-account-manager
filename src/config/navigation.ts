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
  }
];

