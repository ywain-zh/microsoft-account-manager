import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function getContentType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function resolveAssetPath(rootDir: string, pathname: string): string {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const relativePath = normalizedPath.replace(/^[/\\]+/, '') || 'index.html';
  const absolutePath = resolve(rootDir, relativePath);
  const allowedRoot = resolve(rootDir);
  const allowedPrefix = `${allowedRoot}${allowedRoot.endsWith(sep) ? '' : sep}`;

  if (absolutePath !== allowedRoot && !absolutePath.startsWith(allowedPrefix)) {
    throw new Error('非法资源路径');
  }

  return absolutePath;
}

export function createStaticAssetFetcher(rootDir: string): Fetcher {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD' }
        });
      }

      let filePath: string;
      try {
        filePath = resolveAssetPath(rootDir, new URL(request.url).pathname);
      } catch {
        return new Response('Not Found', { status: 404 });
      }

      try {
        const body = await readFile(filePath);
        const headers = new Headers({
          'cache-control': 'public, max-age=300',
          'content-type': getContentType(filePath)
        });

        if (request.method === 'HEAD') {
          return new Response(null, { status: 200, headers });
        }

        return new Response(body, { status: 200, headers });
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }
  };
}
