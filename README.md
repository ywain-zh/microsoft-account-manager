# Microsoft Account Manager

一个适合自托管小服务器的微软邮箱与自建邮箱管理服务。

当前主运行方案已经切换为：
- 前端：Vue 3 + Naive UI
- 后端：Hono + Node.js
- 数据库：外置 SQLite
- 部署：预构建镜像 + `docker compose pull && docker compose up -d`

## 核心能力
- 微软账号增删改查
- 文本和文件批量导入账号
- Graph / IMAP 模式邮件读取
- Cloud Mail 账号管理与邮件查看
- 开放 API 调用
- 管理台登录、备注维护、批量刷新

## 为什么改成这个方案
- 项目本身业务很轻，不值得把旧本地模拟链路和前端构建链带到线上服务器。
- 2C2G 服务器更适合“只运行、不构建”的方案。
- 现在服务器只负责拉镜像、挂载数据目录、启动容器和健康检查，不再默认承担 `docker build`、`npm ci`、`vite build`。

## 项目结构

```text
.
├─ src/                    # Vue 管理台
├─ server/                 # Node 入口、Hono 应用、SQLite 适配、迁移与导入工具
├─ migrations/             # SQLite 迁移脚本
├─ dist/                   # 前端构建产物
├─ build/                  # 后端构建产物
├─ Dockerfile              # 仅供本地或 CI 构建镜像
├─ docker-compose.yml      # 纯 image 模式部署
├─ .env.example            # 运行环境变量示例
└─ DEPLOY_LITE.md          # 轻量部署说明
```

## 本地开发

### 安装依赖

```bash
npm install
```

### 前端开发

```bash
npm run dev:web
```

### 后端开发

```bash
npm run dev:server
```

默认端口：
- 前端开发：Vite 默认端口
- 后端开发：`8787`

### 本地构建

```bash
npm run typecheck
npm run build
```

### 本地数据库工具

```bash
# 手动执行迁移
npm run db:migrate

# 从旧本地 SQLite 库导入
npm run db:import-legacy
```

## 运行配置
运行所需的主要环境变量：
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `INGEST_TOKEN`
- `MAIL_API_TOKEN`
- `DB_PATH`

更多细节见 [DEPLOY_LITE.md](./DEPLOY_LITE.md) 和 [.env.example](./.env.example)。

## 轻量部署原则
- 服务器禁止执行 `docker compose up -d --build`
- 服务器禁止执行 `docker build`
- 服务器禁止执行 `npm ci`、`npm install`、`npm run build`、`vite build`
- 升级默认只走：

```bash
docker compose pull
docker compose up -d
```

## 数据迁移
- 新数据库默认使用 `/app/data/account-manager.db`
- 首次启动若检测到旧本地 SQLite 数据库文件，且目标数据库不存在，会自动导入旧库
- 每次启动都会执行幂等迁移，保证结构补齐

## API 能力
- 管理端登录与账户管理
- 开放取件接口
- 外部账号导入接口
- Cloud Mail 配置与收件箱读取

现有接口路径保持不变，前端和外部调用方无需按这次运行时改造去改 URL。

## 部署文档
- 轻量部署：见 [DEPLOY_LITE.md](./DEPLOY_LITE.md)
- 环境变量示例：见 [.env.example](./.env.example)

## 注意事项
- 本仓库主支持路线是自托管 Node + SQLite 方案，旧运行链路不再作为默认部署路径。
- 如需升级，请先在本地或 CI 构建镜像并推送，再让服务器执行 `pull + up -d`。
