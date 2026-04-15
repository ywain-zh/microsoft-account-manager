import { resolveRuntimeConfig } from '../runtime/env.js';
import { importLegacyDatabase } from '../runtime/legacy-db.js';

const config = resolveRuntimeConfig();
const overwrite = process.argv.includes('--overwrite');
const result = importLegacyDatabase({
  databasePath: config.dbPath,
  legacyDirectory: config.legacyDbDir,
  overwrite
});

if (!result.sourcePath) {
  console.log(`未找到可导入的旧 D1 本地数据库目录: ${config.legacyDbDir}`);
} else if (!result.imported) {
  console.log(`目标数据库已存在，跳过导入: ${result.destinationPath}`);
} else {
  console.log(`已导入旧数据库: ${result.sourcePath} -> ${result.destinationPath}`);
}
