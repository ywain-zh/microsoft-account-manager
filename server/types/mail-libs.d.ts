declare module 'imapflow' {
  export class ImapFlow {
    constructor(options: Record<string, unknown>);
    connect(): Promise<void>;
    logout(): Promise<void>;
    getMailboxLock(path: string): Promise<{ release(): void }>;
    status(path: string, query: Record<string, unknown>): Promise<Record<string, unknown>>;
    fetch(
      range: string,
      query: Record<string, unknown>,
      options?: Record<string, unknown>
    ): AsyncIterable<Record<string, unknown>>;
  }
}

declare module 'mailparser' {
  export function simpleParser(source: unknown, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

declare module 'nodemailer' {
  interface MailTransport {
    verify(): Promise<unknown>;
    sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
    close?(): void;
  }

  const nodemailer: {
    createTransport(options: Record<string, unknown>): MailTransport;
  };

  export default nodemailer;
}
