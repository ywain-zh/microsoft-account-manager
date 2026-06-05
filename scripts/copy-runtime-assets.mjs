import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const assets = [
  ['server/runtime/sub2api-long-link-helper.py', 'build/server/runtime/sub2api-long-link-helper.py']
];

for (const [source, target] of assets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

console.log(`Copied ${assets.length} runtime asset(s).`);
