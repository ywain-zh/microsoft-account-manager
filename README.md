# Microsoft Account Manager

一个面向小型自托管服务器的微软邮箱与自建邮箱管理服务。

当前主运行方案：
- 前端：Vue 3 + Naive UI
- 后端：Hono + Node.js
- 数据库：外置 SQLite
- 部署：预构建镜像 + 固定 tag + 服务器仅 `pull` / `up -d`

## 核心能力
- 微软账号增删改查
- 文本和文件批量导入账号
- Graph / IMAP 模式邮件读取
- Cloud Mail 账号管理与邮件查看
- 开放 API 调用
- 管理台登录、备注维护、批量刷新

## 为什么改成这个方案
- 项目业务本身较轻，更适合单服务、单容器、自托管方案。
- 目标服务器只有 `2C2G`，必须优先保证部署安全，不让升级过程把机器拖死。
- 服务器不再承担构建职责，只负责拉镜像、挂载数据目录、启动容器和健康检查。

## 部署硬约束
- `DEPLOY_LITE.md` 是后续唯一标准部署文档。
- 改造完成后必须先输出审核说明，再等待用户确认。
- 没有用户明确审核通过，不允许部署。
- 没有用户明确批准，不允许执行 `docker compose pull`、`docker compose up -d`、`docker run`、替换线上服务、删除旧服务、切换正式端口。
- 每次部署前必须先编写对应的 `releases/RELEASE-*.md`；没有 release 文档，不允许部署。
- 生产环境禁止使用 `latest`，必须使用已审核通过的固定镜像 tag。
- 不要仅根据本文件执行部署命令；部署时必须严格按 [DEPLOY_LITE.md](./DEPLOY_LITE.md) 执行。

## 代码修改后的发布顺序
以后改代码后的标准路径固定如下：
1. 本地执行 `npm run typecheck` 和 `npm run build`。
2. 基于 `releases/RELEASE_TEMPLATE.md` 新建本次 `releases/RELEASE-*.md`。
3. 提交代码并 `git push origin dev`。
4. 创建固定 tag 并 push，例如 `git tag 2026.04.16-1 && git push origin 2026.04.16-1`。
5. 等待 GitHub Actions 将镜像发布到 `ghcr.io/ywain-zh/microsoft-account-manager:<tag>`。
6. 用户审核通过并明确批准后，才允许按 [DEPLOY_LITE.md](./DEPLOY_LITE.md) 去服务器执行 `docker compose pull` 和 `docker compose up -d`。

这条顺序是后续唯一推荐路径。服务器不负责构建，只负责拉固定 tag 镜像并运行。

## 项目结构

```text
.
├─ src/                         # Vue 管理台
├─ server/                      # Node 入口、Hono 应用、SQLite 适配、迁移与导入工具
├─ migrations/                  # SQLite 迁移脚本
├─ releases/                    # release 模板与每次发布记录
├─ dist/                        # 前端构建产物
├─ build/                       # 后端构建产物
├─ Dockerfile                   # 仅供本地或 CI 构建镜像
├─ docker-compose.yml           # 纯 image 模式部署
├─ package.runtime.json         # 运行镜像最小依赖清单
├─ package.runtime-lock.json    # 运行镜像锁文件
├─ .env.example                 # 运行环境变量示例
├─ DEPLOY_LITE.md               # 唯一标准部署文档
└─ REFactor_PLAN.md             # 轻量化改造说明与执行计划
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
npm run db:migrate
npm run db:import-legacy
```

## 运行配置
运行所需的主要环境变量：
- `APP_IMAGE`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `INGEST_TOKEN`
- `MAIL_API_TOKEN`
- `DB_PATH`

更多细节见 [DEPLOY_LITE.md](./DEPLOY_LITE.md) 和 [.env.example](./.env.example)。

## 数据迁移
- 新数据库默认使用 `/app/data/account-manager.db`
- 首次启动若检测到旧本地 SQLite 数据库文件，且目标数据库不存在，可按配置自动导入旧库
- 每次启动都会执行幂等迁移，保证结构补齐

## API 能力
- 管理端登录与账户管理
- 开放取件接口
- 外部账号导入接口
- Cloud Mail 配置与收件箱读取

现有接口路径保持不变，前端和外部调用方无需因为本次运行时改造调整 URL。

## 文档入口
- 改造说明与清单：见 [REFactor_PLAN.md](./REFactor_PLAN.md)
- 唯一标准部署文档：见 [DEPLOY_LITE.md](./DEPLOY_LITE.md)
- release 模板与发布记录：见 [releases/](./releases)
- 环境变量示例：见 [.env.example](./.env.example)

## 注意事项
- 本仓库主支持路线是自托管 Node + SQLite 方案，旧本地模拟链路不再作为默认部署路径。
- 镜像构建只能在本地开发机或外部 CI 执行，不能挪到服务器现场执行。
- 如需部署或升级，请先准备并审核 release 文档，再严格按 [DEPLOY_LITE.md](./DEPLOY_LITE.md) 操作。
