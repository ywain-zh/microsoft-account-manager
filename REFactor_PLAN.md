# 2C2G 轻量化改造说明与执行计划

## 当前项目现状分析
- 当前项目是一个轻量脚本型管理服务，核心能力集中在微软邮箱读取、自建邮箱读取、账户管理和简单的管理后台。
- 前端为 Vue 3 + Vite 管理台，后端核心逻辑目前集中在单个 Hono 应用文件中，并通过 Cloudflare Worker 本地模拟链路运行。
- 当前部署链路把开发态工具直接带到了服务器：`Dockerfile` 中执行 `npm ci` 和 `npm run build`，运行态通过 `scripts/docker-entrypoint.sh` 执行 `npm run migrate:local` 和 `npx wrangler dev --local`。
- 当前 README 仍引导使用 `docker compose up -d --build`，这会让服务器承担镜像构建、依赖安装、前端构建和本地 Worker 模拟的全部开销。
- 已确认本地 `node_modules` 约 `310.61MB`，前端 `dist` 约 `0.75MB`；此前线上镜像约 `832MB`，运行态容器约占 `267.6MiB` 内存，而目标服务器总内存约 `1608MB`。
- 已确认旧 D1 本地数据实际就是可复制的 SQLite 文件，位于 `data/wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`。

## 当前部署方式为什么过重
- 服务器承担了 `npm ci`、`vite build`、镜像构建、Wrangler 本地模拟、D1 本地迁移等多段高负载任务。
- 运行态使用 `wrangler dev --local`，会额外启动本地 Worker 模拟、临时 bundle 和 wrangler 状态目录，不适合长期稳定运行在 2C2G 小机器上。
- `docker-compose.yml` 使用 `build:`，意味着每次升级都容易习惯性触发本机构建，而不是通过预构建镜像直接拉取。
- 当前运行镜像混入了源码、前端构建链、Wrangler 配置和开发工具，镜像体积偏大，启动时也做了过多初始化动作。

## 导致服务器卡顿或失联的根因
- `docker compose up -d --build` 会在服务器上直接拉起高 CPU、高 IO 的 Docker 构建流程。
- `npm ci` 和 `npm run build` 会吃掉大量内存和磁盘缓存，小机器上容易触发 swap、OOM 或 SSH 卡顿。
- `wrangler dev --local` 不是轻量生产运行时，会持续带来额外的 CPU、内存和临时文件开销。
- 部署链路缺少“服务器只运行、不构建”的边界，导致升级动作本身就是事故源头。

## 改造目标
- 将项目重构为适合 2C2G 小服务器的单容器、单服务、自托管轻量方案。
- 保留现有核心业务能力和现有管理台，不重写业务、不引入重架构。
- 让服务器只负责拉取镜像、挂载数据目录、启动服务和做健康检查。
- 杜绝默认在服务器执行 `npm ci`、`npm install`、`npm run build`、`vite build`、`docker build`、`docker compose up -d --build`。

## 最终选型说明
- 运行时改为 `Node.js + Hono + SQLite（better-sqlite3）` 单进程方案。
- 现有前端继续保留为 Vue 管理台，但只保留预构建后的静态资源，不再让服务器参与前端构建。
- 数据库存储从 Wrangler/D1 本地模拟切换为外置 SQLite 文件，路径固定为 `/app/data/account-manager.db`。
- 升级方式固定为“镜像仓库 pull + 轻量重启”，不再使用服务器本机构建。

## 轻量化原则
- 单容器优先。
- 单服务优先。
- image 模式优先，避免 build 模式。
- 数据目录外置挂载，配置与代码分离。
- 运行镜像只保留必要产物，不带开发态工具链。
- 服务器只负责运行，不负责编译。

## 风险点
- 运行时从 Wrangler 本地模拟切换到 Node，需要验证接口行为和认证行为保持兼容。
- 旧 D1 本地数据库切换到新 SQLite 路径时，需要保证迁移和导入幂等、安全、可回滚。
- 前端和后端构建链拆开后，需要保证本地/CI 构建产物与运行镜像一致。
- Node SQLite 适配层需要兼容现有 D1 风格查询调用，避免隐性行为差异。

## 当前落地结果
- Hono 业务 API 已迁移到 Node 自托管入口，Wrangler 本地运行链路已退出主方案。
- SQLite 已使用 `better-sqlite3` 落地，避免依赖实验性内置模块。
- 已新增幂等迁移执行器和旧 D1 本地库导入工具。
- 已生成轻量 Dockerfile、纯 `image:` 模式 compose、`.env.example` 和独立部署说明。
- 已补充清理 `.wrangler` 缓存目录、空 `worker/` 目录、旧开发日志和误导性的旧链路文案。
- 已额外清理项目外层目录中的临时会话文件和历史 `.tgz` 打包产物，避免遗留敏感信息和旧部署包。

## 不允许做的事情
- 不允许默认在服务器执行 `docker compose up -d --build`。
- 不允许默认在服务器执行 `docker build`、`npm ci`、`npm install`、`npm run build`、`vite build`。
- 不允许在未审核前直接替换线上服务、停旧服务、删旧容器、改正式端口。
- 不允许跳过本文件和 Checklist 维护。

## 最终推荐部署方式
- 本地开发机或外部 CI 构建镜像并推送到镜像仓库。
- 服务器侧只保留 `.env`、`docker-compose.yml` 和外置 `./data` 数据目录。
- 服务器升级命令固定为：
  - `docker compose pull`
  - `docker compose up -d`
- 服务健康检查通过后完成上线，避免任何高负载构建动作落到服务器。

## 回滚思路
- 保留上一个可用镜像 tag，若升级异常，直接切回上一版镜像并 `docker compose up -d`。
- 切换前备份外置 SQLite 数据文件；若数据库迁移出现不兼容，可回滚到升级前备份。
- 旧 `data/wrangler/.../*.sqlite` 保留到新链路稳定验证完成后再决定是否归档。

## 执行计划清单（Checklist）
- [x] 审查当前项目结构与依赖
- [x] 审查 Dockerfile 与 compose 配置
- [x] 定位高负载构建来源
- [x] 确认轻量化改造目标
- [x] 设计轻量部署方案
- [x] 创建 REFactor_PLAN.md 并写入首版说明
- [x] 简化项目结构
- [x] 用 Node + SQLite 替换 Wrangler 本地运行时
- [x] 增加旧 D1 本地库导入工具
- [x] 移除不必要的重型构建环节
- [x] 生成轻量 Dockerfile
- [x] 生成 image 模式 docker-compose.yml
- [x] 生成 .env.example
- [x] 生成部署说明文档
- [x] 输出审核说明
- [x] 等待用户审核
