declare module 'katex' {
  export interface KatexOptions {
    [key: string]: unknown;
  }

  export function renderToString(expression: string, options?: KatexOptions): string;

  const katex: {
    renderToString: typeof renderToString;
  };

  export default katex;
}
