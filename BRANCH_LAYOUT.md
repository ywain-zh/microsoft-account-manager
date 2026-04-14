# Branch Layout

本仓库已按下面的原则整理本地 Git 结构：

- `upstream` 只作为上游同步来源
- `origin` 只作为你自己的代码托管和部署来源

## Remote Roles

| Remote | URL | 用途 |
| --- | --- | --- |
| `upstream` | `https://github.com/Msg-Lbo/microsoft-account-manager.git` | 仅用于同步上游原仓库 |
| `origin` | `https://github.com/ywain-zh/microsoft-account-manager.git` | 仅用于你自己的 fork 托管、推送和部署 |

## Verified Status

以下状态是本地在 `2026-04-12` 克隆并检查远端后确认的真实结果：

- `upstream/main` 当前提交：`e7347771ede47306376f3b952148347798b1804d`
- `origin/main` 当前提交：`e7347771ede47306376f3b952148347798b1804d`
- 当前远端只存在 `main` 分支，没有远端 `dev` / `release`
- 你给出的 `main = 5becc82` 与当前远端实际状态不一致；本次整理以远端真实提交 `e7347771ede47306376f3b952148347798b1804d` 为准

## Local Branches

### `main`

- 目标职责：尽量保持接近 `upstream/main`
- 当前提交：`e7347771ede47306376f3b952148347798b1804d`
- 当前跟踪：`upstream/main`
- 使用规则：
  - 只从 `upstream/main` 获取同步
  - 不在这个分支上做长期本地定制开发
  - 不把 `origin` 当作 `main` 的同步来源

### `dev`

- 目标职责：你自己的开发分支
- 当前提交：`e7347771ede47306376f3b952148347798b1804d`
- 创建方式：基于当前干净的 `main` 创建
- 当前跟踪：未设置远端跟踪分支
- 使用规则：
  - 所有本地定制、修复、复现都在这里完成
  - 需要备份或协作时，再推送到 `origin/dev`

### `release`

- 目标职责：准备部署的分支
- 当前提交：`e7347771ede47306376f3b952148347798b1804d`
- 创建方式：由于当前远端不存在 `release`，本次先基于当前干净的 `main` 初始化本地 `release`
- 当前跟踪：未设置远端跟踪分支
- 使用规则：
  - 建议只接收已经在 `dev` 验证通过的内容
  - 后续如果你要恢复旧的发布历史，可以再单独整理这个分支

## Current Local Layout Summary

| Branch | 当前提交 | 跟踪分支 | 说明 |
| --- | --- | --- | --- |
| `main` | `e7347771ede47306376f3b952148347798b1804d` | `upstream/main` | 上游同步基线 |
| `dev` | `e7347771ede47306376f3b952148347798b1804d` | 无 | 本地开发分支 |
| `release` | `e7347771ede47306376f3b952148347798b1804d` | 无 | 本地发布准备分支 |

## Suggested Workflow

1. 在 `main` 上只做上游同步。
2. 在 `dev` 上做你自己的开发、修复、实验和复现。
3. 测试通过后，再把需要部署的内容合并到 `release`。
4. 只有在需要备份、协作或部署时，才把 `dev` / `release` 推送到 `origin`。

## Useful Commands

同步上游到本地 `main`：

```bash
git checkout main
git fetch upstream
git merge --ff-only upstream/main
```

把当前开发分支推送到你的 fork：

```bash
git checkout dev
git push -u origin dev
```

把发布分支推送到你的 fork：

```bash
git checkout release
git push -u origin release
```
