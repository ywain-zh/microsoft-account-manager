# 轻量部署说明

## 目标
- 服务器只负责拉取镜像和运行容器，不参与任何构建。
- 所有高负载操作都放到本地开发机或外部 CI。
- 数据目录外置，方便迁移、备份和回滚。

## 目录准备
在服务器部署目录仅保留以下内容：
- `docker-compose.yml`
- `.env`
- `data/`

`data/` 会映射到容器内 `/app/data`，新的 SQLite 数据库路径默认是 `/app/data/account-manager.db`。

## 环境变量
1. 复制 `.env.example` 为 `.env`
2. 至少填写以下变量：
- `APP_IMAGE`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `INGEST_TOKEN`

如需单独开放邮件读取令牌，再填写 `MAIL_API_TOKEN`；留空时后端会回退复用 `INGEST_TOKEN`。

## 构建与发版
推荐在本地开发机或 CI 执行：

```bash
npm ci
npm run build
docker build -t ghcr.io/your-org/microsoft-account-manager:TAG .
docker push ghcr.io/your-org/microsoft-account-manager:TAG
```

## 服务器上线
服务器只执行以下命令：

```bash
docker compose pull
docker compose up -d
```

禁止在服务器执行：
- `docker compose up -d --build`
- `docker build`
- `npm ci`
- `npm install`
- `npm run build`
- `vite build`

## 数据迁移
- 新服务启动时会优先检查 `DB_PATH` 指向的 SQLite 文件。
- 如果目标数据库不存在，且 `AUTO_IMPORT_LEGACY_DB=true`，服务会自动尝试从旧本地数据库目录 `LEGACY_DB_DIR` 导入最新的 `.sqlite` 文件。
- 启动后会自动执行幂等迁移，不再依赖旧本地模拟运行时。

如需手动导入旧库：

```bash
node build/server/cli/import-legacy.js
```

如需手动执行迁移：

```bash
node build/server/cli/migrate.js
```

## 回滚
1. 保留上一版镜像 tag。
2. 升级前备份 `data/account-manager.db`。
3. 如新版本异常，恢复上一版镜像 tag 并执行：

```bash
docker compose up -d
```

4. 如数据库升级不兼容，回滚升级前备份的 SQLite 文件。
