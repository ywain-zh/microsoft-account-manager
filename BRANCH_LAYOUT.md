# Branch Layout

本仓库采用“上游基线 + 本仓库集成 + AI 专用工作分支”的 Git 工作流。

## Remote Roles

| Remote | URL | 用途 |
| --- | --- | --- |
| `upstream` | `https://github.com/Msg-Lbo/microsoft-account-manager.git` | 上游原项目仓库，只用于同步原始代码基线 |
| `origin` | `https://github.com/ywain-zh/microsoft-account-manager.git` | 当前维护仓库，用于托管 `dev`、`clouded`、后续 `codex` 以及发布记录 |

## Branch Roles

### `main`

- 当前跟踪：`upstream/main`
- 角色：上游镜像基线分支
- 用途：
  - 接收 `upstream/main` 的完整同步
  - 作为本仓库定制开发的对照基线
  - 为 `dev` 提供上游更新来源
- 规则：
  - 尽量保持接近上游原项目
  - 不作为 Claude / Codex 的日常开发分支
  - 不作为默认发布分支

### `dev`

- 当前跟踪：`origin/dev`
- 角色：本仓库集成与发布主线
- 用途：
  - 汇总 `clouded`、后续 `codex`、以及必要的 `main` 同步内容
  - 统一处理冲突、联调和发布前验证
  - 作为 release 文档、tag、GHCR 镜像和服务器部署的唯一默认来源
- 规则：
  - 所有待发布改动都必须先进入 `dev`
  - 未经过 `dev` 验证的工作分支内容不允许直接部署

### `clouded`

- 创建方式：基于当前 `dev` HEAD 创建
- 角色：Claude 专用工作分支
- 用途：
  - Claude 默认在该分支上实现需求、修复问题和更新文档
- 规则：
  - Claude 不直接在 `dev` / `main` 上进行日常开发
  - 需要发布时，先把 `clouded` 合并到 `dev`

### `codex`

- 角色：Codex 专用工作分支
- 用途：
  - 未来 Codex 并行开发时使用
- 规则：
  - 与 `clouded` 遵循相同流程
  - 后续启用时，也应基于当前 `dev` 创建，并在发布前先合并回 `dev`

### `release`（可选）

- 角色：可选封版 / 归档分支
- 规则：
  - 不再作为默认发布主路径
  - 如果保留，只用于记录已经从 `dev` 验证通过的封版状态

## Current Ground Truth

当前仓库已经确认的真实状态如下：

- `main -> upstream/main`
- `dev -> origin/dev`
- `main` 对应上游原项目的完整同步基线
- `dev` 对应当前仓库自己的集成与发布主线
- `clouded` 已基于当前 `dev` 创建，用作 Claude 的默认工作分支

可以把当前结构理解为：

- `main` = 上游项目“全量文件基线”
- `dev` = 当前仓库自己的可发布集成线
- `clouded` / `codex` = AI 专用开发入口

## Standard Workflow

### 1. 上游同步（按需）

仅当需要吸收上游更新时执行：

```bash
git checkout main
git fetch upstream
git merge --ff-only upstream/main
```

如需把上游更新落到当前仓库，再继续：

```bash
git checkout dev
git merge --no-ff main
```

### 2. AI 专用分支开发

- Claude 在 `clouded` 工作
- Codex 在 `codex` 工作
- 不直接在 `dev` / `main` 做日常功能开发

### 3. 合并到 `dev`

发布前必须先把所有待发布改动汇总到 `dev`：

```bash
git checkout dev
git pull origin dev
git merge --no-ff clouded
# 如本次还包含 Codex 的改动，再执行：
# git merge --no-ff codex
```

### 4. 在 `dev` 统一解决冲突

所有以下冲突都统一在 `dev` 解决：

- `main -> dev` 的上游同步冲突
- `clouded -> dev` 的 Claude 改动冲突
- `codex -> dev` 的 Codex 改动冲突
- 多个工作分支同时进入发布时的逻辑冲突

冲突解决后，必须在 `dev` 重新完成验证。

### 5. 发布前验证与记录

在 `dev` 上执行：

```bash
npm run typecheck
npm run build
```

然后：

1. 基于 `releases/RELEASE_TEMPLATE.md` 创建本次 `releases/RELEASE-*.md`
2. 在 release 文档中记录：
   - 本次来源分支
   - 本次集成分支（`dev`）
   - 是否涉及冲突处理
   - 是否涉及 `upstream/main` 同步
   - 验证结果

### 6. 发布流程

发布固定顺序如下：

```bash
git checkout dev
git push origin dev
git tag YYYY.MM.DD-N
git push origin YYYY.MM.DD-N
```

随后：

1. 等待 GHCR 中对应固定 tag 镜像可用
2. 用户审核通过并明确批准后
3. 严格按 `DEPLOY_LITE.md` 执行服务器 `pull / up -d / 健康检查`

## Conflict Handling Rules

- 冲突优先在 `dev` 解决，而不是在 `main` 解决
- `main` 只负责承接上游，不承担日常功能取舍
- 若 `clouded` 与 `codex` 修改同一区域，以 `dev` 上最终可运行、可验证、符合当前项目目标的结果为准
- 每次冲突解决后必须重新执行：
  - `npm run typecheck`
  - `npm run build`
  - 关键流程冒烟验证
- release 文档必须记录是否发生冲突，以及处理结论

## Do / Don't

### Do

- 在 `main` 上只做上游同步
- 在 `clouded` / `codex` 上做各自的日常开发
- 在 `dev` 汇总待发布内容
- 在 `dev` 统一解决冲突并完成发布前验证
- 从 `dev` 生成 release 文档、tag 和部署版本

### Don't

- 不要在 `main` 上做长期本地定制开发
- 不要直接从 `clouded` / `codex` 部署
- 不要跳过 `dev` 集成就打 tag
- 不要把 `origin/main` 误当作当前主开发与发布分支

## Useful Commands

创建并推送 Claude 专用分支：

```bash
git checkout dev
git branch clouded dev
git checkout clouded
git push -u origin clouded
```

后续创建并推送 Codex 专用分支：

```bash
git checkout dev
git branch codex dev
git checkout codex
git push -u origin codex
```

查看当前分支与跟踪关系：

```bash
git branch -vv
git remote -v
```
