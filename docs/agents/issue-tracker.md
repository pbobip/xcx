# Issue tracker: GitHub

本项目的任务和 PRD 使用 GitHub 仓库 [`pbobip/xcx`](https://github.com/pbobip/xcx) 的 Issues 管理。

## 约定

- 创建、读取、评论、标记和关闭任务时使用 GitHub Issues。
- 发布任务时显式指定仓库 `pbobip/xcx`，不得发布到其他仓库。
- 任务按依赖顺序发布，阻塞任务必须引用真实 Issue 编号。
- 可由 Codex 独立实施的任务使用 `ready-for-agent` 标签。
- 当前电脑尚未安装 GitHub CLI；发布 Issues 前必须安装并完成 GitHub 登录。

## Pull Request

**Pull Request 不作为需求入口。**

外部 PR 不进入 `triage` 队列；本项目只通过 GitHub Issues 管理需求和实施任务。

## 技能映射

- 当技能要求“发布到任务系统”时，创建 GitHub Issue。
- 当技能要求“读取任务”时，读取对应 Issue 的正文、标签和评论。
- 当技能要求“完成任务”时，在验证通过后评论结果并关闭 Issue。
