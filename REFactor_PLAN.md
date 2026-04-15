# 2C2G 轻量化改造说明与执行计划

## 当前项目现状分析
- 当前项目主运行方案已经切换为 `Node.js + Hono + SQLite` 单服务自托管模式，核心能力保持为微软邮箱读取、自建邮箱读取、账户管理和轻量管理后台。
- 前端继续保留 Vue 3 + Vite 管理台，但服务器不再承担前端构建职责；服务器当前目标角色是“只运行镜像、挂载数据、提供健康检查”。
- 历史高负载来源已经从主方案中移除，但其风险仍需保留在文档中作为反例：过去曾把 `docker compose up -d --build`、`docker build`、`npm ci`、`npm run build`、`wrangler dev --local` 一类开发态/构建态动作带到小服务器。
- 已确认本地 `node_modules` 约 `310.61MB`，前端 `dist` 约 `0.75MB`；此前线上镜像约 `832MB`，运行态容器约占 `267.6MiB` 内存，而目标服务器总内存约 `1608MB`。
- 已确认旧 D1 本地数据实际就是可复制的 SQLite 文件，位于 `data/wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`，可作为历史数据导入来源。

## 历史部署方式为什么过重
- 历史链路让服务器承担 `npm ci`、`vite build`、镜像构建、Wrangler 本地模拟、D1 本地迁移等多段高负载任务。
- `docker compose up -d --build` 让每次升级都很容易退化成“在服务器上现场构建”，这对 2C2G 机器不安全。
- `wrangler dev --local` 会引入本地 Worker 模拟、临时 bundle 和 wrangler 状态目录，不适合长期稳定运行在小机器上。
- 历史运行镜像混入了源码、构建链和开发态工具，镜像体积偏大，启动路径也过重。

## 导致服务器卡顿或失联的根因
- `docker compose up -d --build` 会直接拉起高 CPU、高 IO 的 Docker 构建流程。
- `npm ci` 和 `npm run build` 会显著吃掉内存、磁盘缓存和 IO，小机器上容易触发 swap、OOM 和 SSH 卡顿。
- 开发态模拟运行时会引入额外的 CPU、内存和临时文件开销。
- 如果部署流程没有“服务器只运行、不构建”的边界，升级动作本身就会成为事故源头。

## 改造目标
- 将项目固定为适合 2C2G 小服务器的单容器、单服务、自托管轻量方案。
- 保留现有核心业务能力和现有管理台，不重写业务、不引入重型架构。
- 让服务器只负责拉取镜像、挂载数据目录、启动服务和做健康检查。
- 杜绝默认在服务器执行 `npm ci`、`npm install`、`npm run build`、`vite build`、`docker build`、`docker compose up -d --build`。
- 将部署流程、release 要求和审核门槛标准化，作为后续唯一执行依据。

## 最终选型说明
- 运行时使用 `Node.js + Hono + SQLite（better-sqlite3）` 单进程方案。
- 现有前端继续保留为 Vue 管理台，但服务器只接收预构建后的静态资源，不参与前端构建。
- 数据库存储统一为外置 SQLite 文件，路径固定为 `/app/data/account-manager.db`。
- 升级方式固定为“镜像仓库 pull + 轻量重启”，不再使用服务器本机构建。
- 生产部署统一使用固定镜像 tag，不允许依赖 `latest`。

## 轻量化原则
- 单容器优先。
- 单服务优先。
- `image` 模式优先，避免 `build` 模式。
- 数据目录外置挂载，配置与代码分离。
- 运行镜像只保留必要产物，不带开发态工具链。
- 服务器只负责运行，不负责编译。
- 部署流程必须文档化、可重复、可审计。

## 当前阶段约束
- 未经用户审核确认，不允许部署。
- 未经用户审核确认，不允许替换线上服务。
- 未经用户审核确认，不允许删除旧服务。
- 未经用户审核确认，不允许切换正式端口。
- 未经用户明确批准，不允许执行任何会影响线上环境的 `pull`、`up -d`、`docker run`、容器替换操作。

## 运行时依赖瘦身审查结论
- 本轮审查确认：虽然主方案已经切到轻量自托管，但此前最终运行镜像仍会因为根级 `package.json` 共享而保留前端生产依赖。
- 这些前端依赖对运行中的 Node 服务不是必需项，继续携带 `vue`、`vue-router`、`naive-ui`、`dompurify` 进入运行镜像没有必要。
- 本轮已改为独立的 runtime manifest，仅在最终运行镜像中安装最小化运行依赖；构建链保留在本地或 CI 使用，不再混入运行时。
- 当前 `esbuild` 已将服务端代码打包，运行时外部依赖几乎只剩 SQLite 驱动；这属于合理瘦身，不影响功能。

## 风险点
- 运行时从历史本地模拟链路切换到 Node，自托管路径需要持续验证接口行为和认证行为保持兼容。
- 旧 D1 本地数据库切换到新 SQLite 路径时，需要保证迁移和导入幂等、安全、可回滚。
- 前端和后端构建链拆开后，需要保证本地/CI 构建产物与运行镜像一致。
- `better-sqlite3` 属于原生模块，镜像构建仍应只在本地或 CI 完成，不能挪到小服务器现场执行。

## 当前落地结果
- Hono 业务 API 已迁移到 Node 自托管入口，历史本地模拟运行链路已退出主方案。
- SQLite 已使用 `better-sqlite3` 落地，避免依赖实验性内置模块。
- 已新增幂等迁移执行器和旧 D1 本地库导入工具。
- 已生成轻量 Dockerfile、纯 `image:` 模式 compose、`.env.example` 和独立部署说明。
- 本轮已补强 `DEPLOY_LITE.md` 为唯一标准部署文档，并固化部署命令顺序。
- 本轮已新增 `releases/RELEASE_TEMPLATE.md` 和本次 release 文档，部署前必须先完成对应 release 文档。
- 本轮已将运行镜像依赖边界进一步缩小，避免最终镜像继续携带前端运行时依赖。
- 已补充清理 `.wrangler` 缓存目录、空 `worker/` 目录、旧开发日志和误导性的旧链路文案。
- 已额外清理项目外层目录中的临时会话文件和历史 `.tgz` 打包产物，避免遗留敏感信息和旧部署包。

## 不允许做的事情
- 不允许默认在服务器执行 `docker compose up -d --build`。
- 不允许默认在服务器执行 `docker build`、`npm ci`、`npm install`、`npm run build`、`vite build`。
- 不允许在未审核前直接替换线上服务、停旧服务、删旧服务、改正式端口。
- 不允许跳过 release 文档要求。
- 不允许跳过本文件、`DEPLOY_LITE.md` 和 Checklist 维护。

## 最终推荐部署方式
- 本地开发机或外部 CI 构建镜像并推送到镜像仓库。
- 服务器侧只运行固定 tag 镜像，并保留 `.env`、`docker-compose.yml`、`data/`、`releases/` 等轻量部署资料。
- 服务器升级命令固定为：
  - `docker compose pull`
  - `docker compose up -d`
- 所有部署动作都必须以已审核通过的 release 文档和 `DEPLOY_LITE.md` 为前提，不允许临时发明流程。

## 回滚思路
- 保留上一个已验证镜像 tag，若升级异常，直接切回上一版镜像并执行 `docker compose up -d`。
- 切换前备份外置 SQLite 数据文件；若数据库迁移出现不兼容，可回滚到升级前备份。
- 旧 `data/wrangler/.../*.sqlite` 保留到新链路稳定验证完成后再决定是否归档。

## 审核要点
- 确认 `DEPLOY_LITE.md` 已经成为后续唯一标准部署文档。
- 确认生产部署示例已经全面移除 `latest`，统一改为固定 tag。
- 确认 release 模板和本次 release 文档已经补齐。
- 确认运行镜像已经通过独立 runtime manifest 收敛依赖边界。
- 确认当前状态仍是“等待用户审核，禁止部署”。

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
- [x] 完整部署文档已编写
- [x] release 模板已编写
- [x] 本次 release 文档已编写
- [x] 部署命令已全部固化到文档
- [x] 输出审核说明
- [x] 等待用户审核
- [ ] 用户审核通过
- [ ] 获得部署批准后方可部署
