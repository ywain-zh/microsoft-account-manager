# Branch Layout

本仓库采用“上游基线 + 本仓库开发/发布主线”的 Git 工作流。

## Remote Roles

| Remote | URL | 用途 |
| --- | --- | --- |
| `upstream` | `https://github.com/Msg-Lbo/microsoft-account-manager.git` | 上游原项目仓库，只用于同步原始代码基线 |
| `origin` | `https://github.com/ywain-zh/microsoft-account-manager.git` | 当前维护仓库，用于托管 `dev`、发布记录以及当前仓库自己的持续演进 |

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
  - 不作为当前仓库的日常开发分支
  - 不作为默认发布分支

### `dev`

- 当前跟踪：`origin/dev`
- 角色：本仓库日常开发、集成与发布主线
- 用途：
  - 承接当前仓库的所有日常代码修改
  - 汇总必要的 `main` 同步内容
  - 统一完成发布前验证
  - 作为 release 文档、tag、GHCR 镜像和服务器部署的唯一默认来源
- 规则：
  - 日常开发直接在 `dev` 进行
  - 所有待发布改动都必须先进入 `dev`
  - 未经过 `dev` 验证的内容不允许直接部署

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
- `dev` 对应当前仓库自己的开发、集成与发布主线

可以把当前结构理解为：

- `main` = 上游项目“全量文件基线”
- `dev` = 当前仓库自己的默认开发与发布分支

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

### 2. 日常开发

- 日常代码修改直接在 `dev` 进行
- 不把 `main` 当作功能开发分支使用

### 3. 发布前验证与记录

在 `dev` 上执行：

```bash
npm run typecheck
npm run build
```

然后：

1. 基于 `releases/RELEASE_TEMPLATE.md` 创建本次 `releases/RELEASE-*.md`
2. 在 release 文档中记录：
   - 本次来源分支（默认 `dev`）
   - 是否涉及上游同步
   - 是否涉及冲突处理
   - 验证结果

### 4. 发布流程

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

- 上游同步产生的冲突统一在 `dev` 解决，而不是在 `main` 解决
- `main` 只负责承接上游，不承担日常功能取舍
- 每次冲突解决后必须重新执行：
  - `npm run typecheck`
  - `npm run build`
  - 关键流程冒烟验证
- release 文档必须记录是否发生冲突，以及处理结论

## Do / Don't

### Do

- 在 `main` 上只做上游同步
- 在 `dev` 上做日常开发
- 在 `dev` 完成发布前验证
- 从 `dev` 生成 release 文档、tag 和部署版本

### Don't

- 不要在 `main` 上做长期本地定制开发
- 不要跳过 `dev` 验证就打 tag
- 不要把 `origin/main` 误当作当前主开发与发布分支

## Useful Commands

查看当前分支与跟踪关系：

```bash
git branch -vv
git remote -v
```
