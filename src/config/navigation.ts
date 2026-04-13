export interface ConsoleNavChild {
  label: string;
  path: string;
}

export interface ConsoleNavGroup {
  key: string;
  label: string;
  children: ConsoleNavChild[];
}

export const defaultConsoleRoute = '/services/microsoft-mail/accounts';

export const consoleNavigation: ConsoleNavGroup[] = [
  {
    key: 'microsoft-mail',
    label: '微软邮箱',
    children: [
      {
        label: '邮箱列表',
        path: '/services/microsoft-mail/accounts'
      },
      {
        label: '接口管理',
        path: '/services/microsoft-mail/interfaces'
      }
    ]
  }
];
