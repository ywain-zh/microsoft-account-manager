# CLAUDE.md

## Branch Workflow
- Claude 以后默认直接在 `dev` 分支工作，不再使用单独的长期 Claude 工作分支。
- `dev` 是本仓库的日常开发、集成与发布主线；代码修改完成后，继续按 release/tag/部署流程发布。
- `main` 跟踪 `upstream/main`，只作为上游同步基线使用，不作为长期开发分支。

## Release Rule
- 任何发布都必须从 `dev` 发出。
- 发布前必须补齐 release 文档，并在文档中记录来源分支、是否涉及冲突处理、是否包含上游同步。
- 服务器部署严格遵循 `DEPLOY_LITE.md`。
