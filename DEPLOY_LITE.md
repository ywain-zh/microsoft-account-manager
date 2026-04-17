# 轻量部署标准文档

本文件是后续唯一标准部署依据，适用于 `2C2G` 小机器。服务器只负责拉取固定 tag 镜像并运行容器，不负责构建。以后当用户说“请按照部署文档进行服务器部署”时，必须严格按本文件执行，不允许自行发明新流程，不允许跳步骤，不允许替换为高负载命令。

## 部署目标
- 保持服务器侧部署动作轻量、稳定、可回滚。
- 固定服务器角色为“只 pull 镜像、只 up 容器、只做健康检查”。
- 通过外置数据目录和固定 tag 镜像，保证升级、回滚和后续维护可追踪。

## 适用服务器规格说明
- 本文档面向 `2C2G` Linux 服务器。
- 此规格不适合在服务器本机执行 `docker build`、`npm ci`、`npm install`、`npm run build`、`vite build` 一类高负载操作。
- 服务器必须优先采用预构建镜像 + `docker compose pull` + `docker compose up -d` 的方式运行服务。

## 固定变量约定

```bash
export DEPLOY_DIR=/opt/microsoft-account-manager
export CONTAINER_NAME=microsoft-account-manager
export IMAGE_REPO=ghcr.io/ywain-zh/microsoft-account-manager
export IMAGE_TAG=2026.04.15-2
export APP_IMAGE=${IMAGE_REPO}:${IMAGE_TAG}
export RELEASE_DOC=releases/RELEASE-2026-04-15-02.md
```

- 每次新部署前，都必须把 `IMAGE_TAG` 和 `RELEASE_DOC` 改成“本次已审核通过”的版本值。

## 审核确认要求
- 改造完成后必须先输出审核说明，再等待用户审核。
- 没有用户明确审核通过，不允许部署。
- 没有用户明确批准，不允许执行 `docker compose pull`、`docker compose up -d`、`docker run`、替换线上服务、删除旧服务、切换正式端口。
- 没有对应的 release 文档，不允许部署。

## 发布来源分支约束
- `dev` 是本仓库唯一默认发布来源分支。
- `clouded`（Claude 专用分支）和 `codex`（Codex 专用分支）只负责开发，不允许直接部署。
- 以后所有待发布内容必须先合并到 `dev`，再执行 release 文档、tag、GHCR、服务器部署流程。
- 如果本次发布同时包含多个工作分支或 `upstream/main` 同步内容，必须先在 `dev` 完成冲突处理、联调和验证。
- 冲突未解决、验证未完成、release 文档未补齐时，不允许进入部署步骤。

## 部署前 Git 检查项
1. 确认本次待发布提交已经进入 `dev`。
2. 确认本次发布不是直接从 `clouded` / `codex` 发出。
3. 确认如包含 `upstream/main` 同步，本次同步已先进入 `main`，再合并到 `dev`。
4. 确认所有分支冲突已在 `dev` 解决，并完成类型检查、构建和关键流程验证。
5. 确认 release 文档已写明来源分支、集成分支、是否涉及冲突处理、是否涉及上游同步。

部署前检查命令：

```bash
cd /opt/microsoft-account-manager
pwd
ls -lah
test -f .env
test -d data || mkdir -p data
test -f "$RELEASE_DOC"
grep '^APP_IMAGE=' .env
grep -q ':latest$' .env && echo 'ERROR: latest is forbidden' && exit 1 || echo 'APP_IMAGE tag ok'
docker compose ps
docker ps --filter name=microsoft-account-manager
docker images | grep microsoft-account-manager
```

## 本次部署前必须先完成 release 文档
- 每一次准备部署前，必须先创建本次部署对应的 `releases/RELEASE-*.md`。
- release 文档必须说明：
  - 本次发布日期
  - 本次发布版本/tag
  - 本次发布目的
  - 本次修改文件列表
  - 本次更新内容摘要
  - 本次是否涉及配置变更
  - 本次是否涉及数据结构/迁移
  - 本次部署步骤
  - 本次回滚方式
  - 风险说明
- 没有 release 文档，立即停止，不允许继续部署。

## 镜像 tag 选择规则
- 生产环境禁止直接依赖 `latest`。
- 生产环境必须使用固定 tag，例如 `ghcr.io/ywain-zh/microsoft-account-manager:2026.04.15-2`。
- 固定 tag 必须与本次 release 文档中的版本/tag 一致。
- 回滚时必须切回上一个已验证的固定 tag。

## 代码修改后的标准发布流程
以后只要代码有变更，标准流程固定为“上游同步（如需要） -> AI 专用分支开发 -> 合并到 `dev` -> 解决冲突并验证 -> 编写 release 文档 -> 推送 `dev` -> push tag 发镜像 -> 等待审核批准 -> 服务器 pull/up”。不要跳过中间步骤，也不要把构建挪到服务器上执行。

本地发布准备命令：

```bash
cd /path/to/microsoft-account-manager
# 如需同步上游，先执行：
# git checkout main
# git fetch upstream
# git merge --ff-only upstream/main
# git checkout dev
# git merge --no-ff main

# Claude / Codex 在各自工作分支完成开发后，统一合并到 dev
# git checkout dev
# git merge --no-ff clouded
# git merge --no-ff codex

npm run typecheck
npm run build
cp releases/RELEASE_TEMPLATE.md releases/RELEASE-2026-04-16-01.md
git status
git add .
git commit -m "feat: describe this release"
git push origin dev
git tag 2026.04.16-1
git push origin 2026.04.16-1
```

镜像发布检查命令：

```bash
docker manifest inspect ghcr.io/ywain-zh/microsoft-account-manager:2026.04.16-1
```

发布阶段硬约束：
- 只有在 tag push 成功、GHCR 已存在本次固定 tag 镜像后，才允许进入服务器部署阶段。
- 如果 release 文档未写完，或 tag 镜像尚未发布成功，立即停止，不允许部署。
- 服务器侧仍然只允许执行 `docker compose pull` 和 `docker compose up -d` 一类运行命令。

## 环境变量准备步骤
1. 在服务器部署目录中复制 `.env.example` 为 `.env`。
2. 修改 `APP_IMAGE` 为已审核通过的固定 tag。
3. 按需填写管理员账号、会话密钥、令牌、数据库路径等变量。
4. 如果要兼容导入旧本地 SQLite 数据目录，可设置 `AUTO_IMPORT_LEGACY_DB=true` 并填写 `LEGACY_DB_DIR`。

环境变量检查命令：

```bash
cd /opt/microsoft-account-manager
test -f .env
grep -E '^(APP_IMAGE|PORT|DB_PATH|PUBLIC_DIR|MIGRATIONS_DIR|AUTO_IMPORT_LEGACY_DB|LEGACY_DB_DIR)=' .env
grep -q ':latest$' .env && echo 'ERROR: latest is forbidden' && exit 1 || echo 'APP_IMAGE tag ok'
```

## 数据目录准备步骤
- 数据目录必须外置挂载，默认是服务器上的 `./data`，容器内对应 `/app/data`。
- SQLite 默认数据库路径为 `/app/data/account-manager.db`。
- 升级前建议备份 `data/account-manager.db`。

数据目录检查命令：

```bash
cd /opt/microsoft-account-manager
test -d data || mkdir -p data
ls -lah data
du -sh data
```

## 首次部署步骤
以下步骤只在用户明确批准后执行：

```bash
export DEPLOY_DIR=/opt/microsoft-account-manager
export CONTAINER_NAME=microsoft-account-manager
export IMAGE_REPO=ghcr.io/ywain-zh/microsoft-account-manager
export IMAGE_TAG=2026.04.15-2
export APP_IMAGE=${IMAGE_REPO}:${IMAGE_TAG}
export RELEASE_DOC=releases/RELEASE-2026-04-15-02.md

cd "$DEPLOY_DIR"
pwd
ls -lah
test -f .env
test -d data || mkdir -p data
test -f "$RELEASE_DOC"
grep '^APP_IMAGE=' .env
grep -q ':latest$' .env && echo 'ERROR: latest is forbidden' && exit 1 || echo 'APP_IMAGE tag ok'
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=200 microsoft-account-manager
docker stats --no-stream microsoft-account-manager
docker compose exec -T microsoft-account-manager wget -qO- http://127.0.0.1:8787/api/health
```

## 后续升级部署步骤
以后每次部署时，如果用户只说“请按照部署文档进行服务器部署”，则必须执行以下固定流程：
1. 先检查 release 文档是否存在。
2. 先检查 release 文档是否写明版本/tag、修改摘要、风险、回滚方案。
3. 先检查用户是否已明确审核通过并批准部署。
4. 再严格按照本文件的命令顺序执行。
5. 执行过程中禁止擅自增加未列出的高负载命令。
6. 执行完成后必须输出：实际执行了哪些命令、部署结果、当前容器状态、健康检查结果、是否需要回滚。

升级部署标准命令：

```bash
export DEPLOY_DIR=/opt/microsoft-account-manager
export CONTAINER_NAME=microsoft-account-manager
export IMAGE_REPO=ghcr.io/ywain-zh/microsoft-account-manager
export IMAGE_TAG=2026.04.15-2
export APP_IMAGE=${IMAGE_REPO}:${IMAGE_TAG}
export RELEASE_DOC=releases/RELEASE-2026-04-15-02.md

cd "$DEPLOY_DIR"
pwd
ls -lah
test -f .env
test -d data || mkdir -p data
test -f "$RELEASE_DOC"
grep '^APP_IMAGE=' .env
grep -q ':latest$' .env && echo 'ERROR: latest is forbidden' && exit 1 || echo 'APP_IMAGE tag ok'
cp .env ".env.bak.${IMAGE_TAG}"
sed -i "s#^APP_IMAGE=.*#APP_IMAGE=${APP_IMAGE}#" .env
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=200 microsoft-account-manager
docker stats --no-stream microsoft-account-manager
docker compose exec -T microsoft-account-manager wget -qO- http://127.0.0.1:8787/api/health
```

## 回滚步骤
- 回滚前提是已经保留上一个已验证的固定 tag。
- 回滚时不要使用 `latest`，直接切回上一版已验证 tag。
- 如涉及数据库回滚，先恢复升级前备份的 SQLite 文件，再拉起旧镜像。

回滚标准命令：

```bash
export DEPLOY_DIR=/opt/microsoft-account-manager
export IMAGE_REPO=ghcr.io/ywain-zh/microsoft-account-manager
export PREV_IMAGE_TAG=2026.04.14-2

cd "$DEPLOY_DIR"
sed -i "s#^APP_IMAGE=.*#APP_IMAGE=${IMAGE_REPO}:${PREV_IMAGE_TAG}#" .env
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=200 microsoft-account-manager
docker compose exec -T microsoft-account-manager wget -qO- http://127.0.0.1:8787/api/health
```

## 日志查看命令

```bash
cd /opt/microsoft-account-manager
docker compose logs --tail=200 microsoft-account-manager
docker compose logs -f microsoft-account-manager
```

## 服务状态检查命令

```bash
cd /opt/microsoft-account-manager
docker compose ps
docker ps --filter name=microsoft-account-manager
docker inspect microsoft-account-manager --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'
docker stats --no-stream microsoft-account-manager
```

## 健康检查方式

```bash
cd /opt/microsoft-account-manager
docker compose exec -T microsoft-account-manager wget -qO- http://127.0.0.1:8787/api/health
```

期望返回包含 `ok` 的健康状态结果。若健康检查失败，不允许继续视为成功部署。

## 故障排查步骤
1. 先检查容器状态和健康状态。
2. 再看容器日志。
3. 再检查数据目录和环境变量。
4. 再检查主机资源是否不足。
5. 必要时按回滚步骤切回上一版已验证 tag。

故障排查命令：

```bash
cd /opt/microsoft-account-manager
docker compose ps
docker compose logs --tail=200 microsoft-account-manager
docker stats --no-stream microsoft-account-manager
ls -lah data
du -sh data
grep -E '^(APP_IMAGE|PORT|DB_PATH|PUBLIC_DIR|MIGRATIONS_DIR|AUTO_IMPORT_LEGACY_DB|LEGACY_DB_DIR)=' .env
free -h
df -h
docker inspect microsoft-account-manager --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'
```

## 禁止事项
- 禁止在服务器执行 `docker compose up -d --build`。
- 禁止在服务器执行 `docker build`。
- 禁止在服务器执行 `npm ci`、`npm install`、`npm run build`、`vite build`。
- 禁止没有 release 文档就部署。
- 禁止没有审核通过就部署。
- 禁止没有明确批准就执行 `docker compose pull`、`docker compose up -d`、`docker run`、替换线上、删除旧服务、切换正式端口。
- 禁止不按本文件执行部署。

## 标准命令清单

```bash
cd /opt/microsoft-account-manager
pwd
ls -lah
test -f .env
test -d data || mkdir -p data
test -f "$RELEASE_DOC"
grep '^APP_IMAGE=' .env
grep -q ':latest$' .env && echo 'ERROR: latest is forbidden' && exit 1 || echo 'APP_IMAGE tag ok'
docker compose ps
docker ps --filter name=microsoft-account-manager
docker images | grep microsoft-account-manager
cp .env ".env.bak.${IMAGE_TAG}"
sed -i "s#^APP_IMAGE=.*#APP_IMAGE=${APP_IMAGE}#" .env
docker compose pull
docker compose up -d
docker compose logs --tail=200 microsoft-account-manager
docker stats --no-stream microsoft-account-manager
docker compose exec -T microsoft-account-manager wget -qO- http://127.0.0.1:8787/api/health
ls -lah data
du -sh data
grep -E '^(APP_IMAGE|PORT|DB_PATH|PUBLIC_DIR|MIGRATIONS_DIR|AUTO_IMPORT_LEGACY_DB|LEGACY_DB_DIR)=' .env
free -h
df -h
docker inspect microsoft-account-manager --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'
```
