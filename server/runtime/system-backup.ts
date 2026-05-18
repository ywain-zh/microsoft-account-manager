import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

type BackupStatus = 'running' | 'success' | 'error';

export interface SystemBackupJobSnapshot {
  id: string;
  status: BackupStatus;
  createdAt: string;
  updatedAt: string;
  progress: number;
  message: string;
  logs: string[];
  filename: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  error: string | null;
}

interface SystemBackupJob extends SystemBackupJobSnapshot {
  workDir: string;
  archivePath: string | null;
}

interface CommandOptions {
  cwd?: string;
  outputFile?: string;
}

const backupJobs = new Map<string, SystemBackupJob>();
const MAX_JOB_LOGS = 200;
const BACKUP_PROJECT_DIRS = (process.env.SYSTEM_BACKUP_PROJECT_DIRS?.trim() || [
  '/host/opt/microsoft-account-manager',
  '/host/root/sub2api-deploy'
].join(','))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export function startSystemBackup(db: D1Database): SystemBackupJobSnapshot {
  const runningJob = Array.from(backupJobs.values()).find((job) => job.status === 'running');
  if (runningJob) {
    throw new Error('已有备份任务正在运行，请等待完成后再开始新的备份');
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const job: SystemBackupJob = {
    id,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    progress: 0,
    message: '准备开始备份',
    logs: [],
    filename: null,
    sizeBytes: null,
    sha256: null,
    error: null,
    workDir: join(tmpdir(), `aliyun-web-backup-${id}`),
    archivePath: null
  };

  backupJobs.set(id, job);
  void runSystemBackup(db, job);
  return toSnapshot(job);
}

export function getSystemBackupJob(id: string): SystemBackupJobSnapshot | null {
  const job = backupJobs.get(id);
  return job ? toSnapshot(job) : null;
}

export function getSystemBackupArchive(id: string): { path: string; filename: string; sizeBytes: number } | null {
  const job = backupJobs.get(id);
  if (!job || job.status !== 'success' || !job.archivePath || !job.filename || !job.sizeBytes) {
    return null;
  }
  return {
    path: job.archivePath,
    filename: job.filename,
    sizeBytes: job.sizeBytes
  };
}

export async function cleanupSystemBackupJob(id: string): Promise<boolean> {
  const job = backupJobs.get(id);
  if (!job) {
    return false;
  }
  if (job.status === 'running') {
    throw new Error('备份任务仍在运行，不能清理');
  }
  await rm(job.workDir, { recursive: true, force: true });
  backupJobs.delete(id);
  return true;
}

async function runSystemBackup(db: D1Database, job: SystemBackupJob): Promise<void> {
  try {
    const payloadDir = join(job.workDir, 'payload');
    const dumpsDir = join(payloadDir, 'online-dumps');
    const projectsDir = join(payloadDir, 'projects');
    const systemDir = join(payloadDir, 'system');

    await mkdir(dumpsDir, { recursive: true });
    await mkdir(projectsDir, { recursive: true });
    await mkdir(systemDir, { recursive: true });

    updateJob(job, 5, '创建备份工作目录');
    appendLog(job, '开始在线备份，主项目容器保持运行');

    await backupSqliteDatabase(db, join(dumpsDir, 'microsoft-account-manager', 'account-manager.db'), job);
    updateJob(job, 25, '已完成当前项目 SQLite 在线备份');

    await backupSub2ApiPostgres(join(dumpsDir, 'sub2api', 'postgres.sql'), job);
    updateJob(job, 45, '已完成 Sub2API PostgreSQL 导出');

    await backupSub2ApiRedis(join(dumpsDir, 'sub2api', 'redis-dump.rdb'), job);
    updateJob(job, 60, '已完成 Sub2API Redis 快照导出');

    await copyProjectConfigs(projectsDir, job);
    updateJob(job, 72, '已复制项目配置');

    await copySystemConfigs(systemDir, job);
    updateJob(job, 82, '已复制系统配置');

    await writeBackupDocs(payloadDir, job);
    updateJob(job, 88, '已写入恢复说明和 manifest');

    const filename = `aliyun-online-backup-${formatTimestampForFilename(new Date())}.tar.gz`;
    const archivePath = join(job.workDir, filename);
    await runCommand('tar', ['-czf', archivePath, '-C', payloadDir, '.']);
    const sizeBytes = (await stat(archivePath)).size;
    const sha256 = await hashFile(archivePath);
    await writeFile(`${archivePath}.sha256`, `${sha256}  ${filename}\n`, 'utf8');

    job.archivePath = archivePath;
    job.filename = filename;
    job.sizeBytes = sizeBytes;
    job.sha256 = sha256;
    job.status = 'success';
    updateJob(job, 100, '备份完成，可以下载');
    appendLog(job, `备份包大小：${formatBytes(sizeBytes)}`);
    appendLog(job, `SHA256：${sha256}`);
  } catch (error) {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : '备份失败';
    updateJob(job, job.progress, job.error);
    appendLog(job, `ERROR: ${job.error}`);
  }
}

async function backupSqliteDatabase(db: D1Database, outputPath: string, job: SystemBackupJob): Promise<void> {
  appendLog(job, '正在生成当前项目 SQLite 一致副本');
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  await db.exec('PRAGMA wal_checkpoint(PASSIVE);');
  await db.exec(`VACUUM INTO '${escapeSqlString(outputPath)}';`);
}

async function backupSub2ApiPostgres(outputPath: string, job: SystemBackupJob): Promise<void> {
  appendLog(job, '正在通过 sub2api-postgres 容器执行 pg_dumpall');
  await mkdir(dirname(outputPath), { recursive: true });
  await runCommand(
    'docker',
    ['exec', 'sub2api-postgres', 'sh', '-lc', 'pg_dumpall -U "${POSTGRES_USER:-postgres}"'],
    { outputFile: outputPath }
  );
}

async function backupSub2ApiRedis(outputPath: string, job: SystemBackupJob): Promise<void> {
  appendLog(job, '正在通过 sub2api-redis 容器生成 Redis 快照');
  await mkdir(dirname(outputPath), { recursive: true });
  await runCommand('docker', ['exec', 'sub2api-redis', 'sh', '-lc', 'redis-cli SAVE']);
  await runCommand('docker', ['cp', 'sub2api-redis:/data/dump.rdb', outputPath]);
}

async function copyProjectConfigs(projectsDir: string, job: SystemBackupJob): Promise<void> {
  for (const projectDir of BACKUP_PROJECT_DIRS) {
    const target = join(projectsDir, projectDir.replace(/^\/host\//, '').replace(/^\/+/, ''));
    try {
      await stat(projectDir);
      appendLog(job, `正在复制项目配置：${projectDir}`);
      await cp(projectDir, target, {
        recursive: true,
        dereference: false,
        filter: (source) => shouldCopyProjectPath(projectDir, source)
      });
    } catch (error) {
      appendLog(job, `跳过项目目录 ${projectDir}: ${error instanceof Error ? error.message : '不可读取'}`);
    }
  }
}

async function copySystemConfigs(systemDir: string, job: SystemBackupJob): Promise<void> {
  const systemPaths = ['/host/etc/nginx', '/host/etc/cron.d', '/host/var/spool/cron'];
  for (const sourcePath of systemPaths) {
    const target = join(systemDir, sourcePath.replace(/^\/host\//, '').replace(/^\/+/, ''));
    try {
      await stat(sourcePath);
      appendLog(job, `正在复制系统配置：${sourcePath}`);
      await cp(sourcePath, target, {
        recursive: true,
        dereference: false
      });
    } catch (error) {
      appendLog(job, `跳过系统配置 ${sourcePath}: ${error instanceof Error ? error.message : '不可读取'}`);
    }
  }
}

async function writeBackupDocs(payloadDir: string, job: SystemBackupJob): Promise<void> {
  const createdAt = new Date().toISOString();
  const manifest = {
    kind: 'aliyun-online-web-backup',
    createdAt,
    source: 'microsoft-account-manager-system-settings',
    includes: [
      'microsoft-account-manager sqlite VACUUM INTO backup',
      'sub2api pg_dumpall',
      'sub2api redis dump.rdb',
      'project config files',
      'nginx and cron config when mounted'
    ],
    projectDirs: BACKUP_PROJECT_DIRS
  };

  await writeFile(join(payloadDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(
    join(payloadDir, '恢复说明.md'),
    [
      '# 在线备份恢复说明',
      '',
      `备份时间：${createdAt}`,
      '',
      '本备份由望月工具箱系统设置页生成，备份过程中未停止 `microsoft-account-manager` 主容器。',
      '',
      '## 内容',
      '',
      '- `online-dumps/microsoft-account-manager/account-manager.db`：当前项目 SQLite 一致副本。',
      '- `online-dumps/sub2api/postgres.sql`：Sub2API PostgreSQL `pg_dumpall` 导出。',
      '- `online-dumps/sub2api/redis-dump.rdb`：Sub2API Redis 快照。',
      '- `projects/`：项目配置、`.env`、compose 文件等，已尽量排除运行时数据库目录。',
      '- `system/`：nginx、cron 等系统配置，取决于容器挂载权限。',
      '',
      '## 恢复要点',
      '',
      '1. 新服务器先安装 Docker 和 Docker Compose。',
      '2. 恢复项目目录和 `.env` / compose 文件。',
      '3. 将 SQLite 文件放回 `microsoft-account-manager` 的 `data/account-manager.db`。',
      '4. 启动 Sub2API PostgreSQL 后导入 `postgres.sql`。',
      '5. 停止 Redis 后替换 `dump.rdb`，再启动 Redis。',
      '6. 执行 `docker compose pull && docker compose up -d`，最后检查容器健康状态。',
      '',
      '## 安全提醒',
      '',
      '备份包包含数据库、`.env`、API Key 和管理员密码，请只保存到可信本地磁盘。'
    ].join('\n'),
    'utf8'
  );
  appendLog(job, '已生成 manifest.json 和恢复说明.md');
}

function shouldCopyProjectPath(projectRoot: string, source: string): boolean {
  const normalized = source.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.git' || segment === 'node_modules')) {
    return false;
  }
  if (segments.some((segment) => segment === 'postgres_data' || segment === 'redis_data')) {
    return false;
  }
  if (projectRoot.includes('microsoft-account-manager') && segments.includes('data')) {
    return false;
  }
  return true;
}

function runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const output = options.outputFile ? createWriteStream(options.outputFile) : null;
    output?.on('error', (error) => {
      child.kill();
      reject(error);
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (output) {
        output.write(chunk);
      } else {
        stdout += chunk.toString('utf8');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      output?.destroy();
      reject(error);
    });
    child.on('close', (code) => {
      const finish = () => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(`${command} ${args.join(' ')} failed (${code ?? 'unknown'}): ${stderr.trim()}`));
      };

      if (output) {
        output.end(finish);
      } else {
        finish();
      }
    });
  });
}

function toSnapshot(job: SystemBackupJob): SystemBackupJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    message: job.message,
    logs: [...job.logs],
    filename: job.filename,
    sizeBytes: job.sizeBytes,
    sha256: job.sha256,
    error: job.error
  };
}

function updateJob(job: SystemBackupJob, progress: number, message: string): void {
  job.progress = Math.max(0, Math.min(100, progress));
  job.message = message;
  job.updatedAt = new Date().toISOString();
}

function appendLog(job: SystemBackupJob, message: string): void {
  const line = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${message}`;
  job.logs.push(line);
  if (job.logs.length > MAX_JOB_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_JOB_LOGS);
  }
  job.updatedAt = new Date().toISOString();
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function formatTimestampForFilename(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
