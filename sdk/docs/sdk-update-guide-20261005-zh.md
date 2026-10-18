# SDK 更新说明（通俗版）

> 历史记录：legacy 引擎及其 API/CLI 入口已移除。下文保留旧版本设计与验收事实；当前用法见 [CLI/API 手册](main-cli-zh.md)。

更新日期：2026-10-06。包版本：0.1.1，当前仍为开发版，未发布到 npm。

## 一句话说明这次更新

SDK 现在默认使用与网页端同一套执行规则，接入了 Git 协作机制，并支持直接使用 Codex 已有的登录状态。它仍然可以独立运行，不需要先启动网页或后端 HTTP 服务。

这里的“使用 main 内核”，是复用网页后端的执行代码，不是把 SDK 合并到仓库的 main 分支。工作流中的 Main 是管理 Agent，也不是 Git 分支。

## 1. Git 机制有什么用？

可以把它理解为：给每个 Agent 一份自己的工作副本，再把经过检查的成果汇总起来。

开启 Git 后，一次任务大致会经历：

1. 建立任务使用的 Git 仓库，并为 Agent 准备独立工作目录。
2. 执行 Agent 修改文件、提交代码并发起 PR。
3. 审计 Agent 检查交付，必要时提出修改或修复。
4. 成员交付合并后，再通过组的最终 PR 汇总到任务仓库的 main 分支。
5. 管理 Agent 根据正式交付和合并结果判断任务是否完成。

PR 可以理解为“提交一批修改，请求检查和合并”。这里操作的是任务配置指定的仓库，不是自动修改 ScienceEvolve 的源码仓库。

这样做主要是为了减少多个 Agent 互相覆盖文件，并留下“谁改了什么、哪些成果已经合并”的记录。Agent 说“做完了”不再等于课题已经完成；运行时还要检查正式完成动作和必要的交付事实。

Git 不是强制开启的。不需要仓库协作的任务仍可关闭 Git，但不能期待获得 PR 合并和 Git 成果导出的能力。

## 2. 还可以自定义 Agent 和 workflow 吗？

可以。模型、Harness、提示词、Skills、MCP 和工作流结构仍由配置控制，但需要符合新内核的格式和权限规则。

Evolver 可以理解为“允许管理 Agent 根据执行情况，调整后续工作配置”。例如发现执行提示词不够清楚，就修改它，再让后续 Agent 使用新配置。

它不是默认获得所有修改权限：必须在工作流中明确开启相应能力，修改也要经过校验。本轮真实测试验证的是一次正式提示词修改，然后继续执行、审计和交付；不代表所有动态修改组合都已测试完。

## 3. 模型登录和网关有什么变化？

现在有两种明确的接入方式：

- API-key 网关：配置地址、模型和密钥，或导入已有 Harness 的 API-key 配置，测试通过后使用。
- Codex 原生登录：使用 Codex 自己已经登录的账号，不把登录凭据转换成网关 API key。

原生登录目前只支持 Codex，且明确使用官方 OpenAI 路线，不是沿用 CCSwitch 的自定义中转。创智内网模型等第三方模型仍应走 API-key 网关，需要的 VPN 也要连接好。

SDK 不修改原有 Codex 配置，也不复制它的登录 token。登录和正常凭据刷新仍由 Codex 自己处理。

注意：Codex 登录是为了调用模型，GitHub 登录是为了创建仓库、推送和操作 PR。这是两件不同的事，登录一个不能代替另一个。

## 4. 已有代码目录会被修改吗？

新默认模式的 Git-off 任务现在支持 `--workspace` 原地执行，Agent 会直接修改选定的已有目录。
CLI 相对路径按启动目录解析；API 使用 `sdk.start({ workspace: absolutePath, ... })`。
目录必须与显式专用 dataDir 分开且互不包含；保存后供后续轮次和恢复继续使用。

Git-on 现在也用 `--workspace` 接入原项目：从当前文件开始，在独立工作副本中协作，正式完成后把已合并的成果自动放回原目录，不需要再导出一份才能用。原项目的 Git 历史和暂存区保持不变，回写结果是待你检查/提交的文件修改。

任务期间你也改了同一文件时，SDK 会报告冲突，不强行覆盖。检查保留的成果并解决冲突后，用 `run sync-workspace` 重试。源代码快照和回写备份在私有 dataDir 中；失败时可能有部分文件已经安全回写，重试会识别，不需要重跑 Agent。

如果只想读取来源、不希望回写，仍用 `--source-workspace`，与 workspace 互斥。显式 export 到新目录仍可用。目录/worktree 策略未改，串行任务也继续遵循现有策略。

原项目根目录已有 workflow.json 现在不会阻止重配置：运行提案放在独立管理子目录，Main 只修改提案，不覆盖你的启动配置。

上述源码输入、工作副本和成果导出流程适用于 Git-on；Git-off 的指定 workspace 本身就是任务工作目录。

## 5. 旧用户需要注意什么？

默认 SDK 和 CLI 已切换到新内核。继续使用旧模式时，需要明确选择 legacy：

```js
// 新默认入口
import { createResearchSdk } from '@scienceevolve/sdk';

// 旧模式入口
import { createResearchSdk as createLegacyResearchSdk } from '@scienceevolve/sdk/legacy';
```

```powershell
# 使用旧模式时，在原 CLI 命令中加入这个选项
npx scienceevolve --engine legacy --help
```

当前仓库 example 已移除旧网关来源和 reasoning 字段，明确采用 Git-off v2 编排；原角色、模型、Harness、指令、循环和终止逻辑保留。调用方自行保存的旧配置不能不加区分地交给新默认入口，尤其是网关接入字段和工作流结构；旧持久状态不自动迁移。
指定 workspace 不需要切换 legacy：Git-off 直接在原目录工作；Git-on 导入当前源码，在隔离 worktree 执行，正式完成后自动回写原目录。回写是否成功以 workspaceDelivery 为准，实际验收范围见本轮报告。

旧运行数据也不会自动升级。新旧引擎、不同内部运行时版本不能共用同一份数据目录。即使包版本都写着 0.1.1，内部代码也可能不同；继续旧任务应保留对应的包，不要手工改数据标记来强行打开。

## 6. 怎么先跑一个简单任务？

需要 Node.js 24 或更高版本、Git，以及要使用的 Harness。下面以 Windows、已登录的 Codex、关闭 Git 的简单任务为例。

先建立 `D:/research` 目录，并在该目录中安装本地生成的包：

```powershell
Set-Location D:/research

# 准备任务工作目录，与后续的 new-run-data 状态目录分开
New-Item -ItemType Directory -Force D:/research/task-project

# 将路径换成你拿到的安装包位置
npm install "D:/path/scienceevolve-sdk-0.1.1.tgz"

# 生成新内核的简单工作流，不覆盖已有文件
npx scienceevolve workflow init D:/research/workflow.json
```

准备两个文件：

- `task.txt`：写清楚要完成的任务和交付要求。
- `deployment.json`：说明使用哪份 Codex 登录目录。下面的用户名需要替换。

```json
{
  "nativeCodexProfiles": {
    "login": "C:/Users/YOUR_NAME/.codex"
  }
}
```

校验工作流，再启动。把 `YOUR_AVAILABLE_MODEL` 换成你实际可用的 Codex 模型名称：

```powershell
npx scienceevolve workflow validate D:/research/workflow.json

npx scienceevolve run start D:/research/workflow.json D:/research/task.txt `
  --data-dir D:/research/new-run-data `
  --workspace D:/research/task-project `
  --runtime-config D:/research/deployment.json `
  --native-codex-profile login --harness codex --model YOUR_AVAILABLE_MODEL
```

`data-dir` 是 SDK 保存任务状态和过程记录的独立目录，首次运行应使用新的空目录，不能填原项目目录；`workspace` 是已存在的任务目录，两者不能相互包含。上例显式绑定可信原生 Codex profile；API-key 部署须先配置 Gateway 并以 `--gateway` 或 `--gateway-bindings` 绑定，不会隐式读取 `gatewaySource`。这个简单模板没有开启 Git；要测试 Git 协作，需要另行配置 Git 工作流、仓库名称和 GitHub 凭据。

同一数据目录不能同时被两个 SDK 进程打开。CLI 目前是前台运行方式，可以看当前输出；不要为了查看进度，再启动一个进程打开同一目录。

## 7. 停止和恢复有什么要注意的？

- 开启 Git 的任务停止后会保留现场，确认 Agent 停止后可以恢复，不等于删除或彻底取消任务。
- 关闭 Git 的任务，显式 cancel 是终态取消；Ctrl+C 请求的是安全暂停。
- 暂停可能需要等待当前执行到达安全点，不一定马上结束。
- 必须等上一进程安全关闭后再恢复；不能通过删除活动锁，强行启动第二个进程。

另外，list/show/events 等命令也会打开运行时，并遵循自动恢复规则，不是纯粹离线查看文件的工具。

## 8. 10 月 5 日历史验收到了什么程度？

已经在 Windows 上使用安装后的包、真实 Codex 模型和专用私有 GitHub 仓库，跑通了：

- 普通调用使用 Codex 原生登录，并正式完成任务。
- 三 Agent 的提示词修改、执行、独立审计及三个 PR 合并。
- 最终成果导出，宿主实际运行三个 Python 测试并全部通过。
- 关闭后重新打开，任务仍保持完成，没有重跑已完成的业务。

测试过程中还修复了缺失的运行模块、账号/Skills 通知误判、控制连接重置导致宿主崩溃，以及普通调用无法读取本轮任务输入的问题。

全量本地测试为 580 通过、4 个旧 Windows 文件符号链接权限失败、1 跳过。类型检查、构建和仓库外安装包回归通过。

这些结果不等于所有环境都已经验证：四个 Harness 的真实模型全矩阵，以及 Linux/macOS 的完整真实验收尚未完成。当前非 yolo 的 Git 协作文件隔离机制只支持 Windows/Linux，在 macOS 上会明确拒绝，不能直接宣称可用。

模型调用可能消耗费用或配额；Git 功能会真实创建、推送和合并。原生 OAuth 的统计不等同于网关的逐请求 Token 账本，缺失或显示零不能理解为免费。

## 当前交付状态与详细说明

2026-10-06 后续工作已经适配两种 Git 模式的 workspace、保护原 workflow.json，并更新示例/Skill。Codex、Pi、DSH 的 Windows 原目录真实任务已跑通；本轮源码交付到现有 `feat/sdk-only-v0.1.1` 分支，最新验收范围以 [本轮记录](workspace-main-acceptance-20261006-zh.md) 为准，不用下方历史数字代替。

SDK 源码已快进合入原有云端分支 [feat/sdk-only-v0.1.1](https://github.com/fnlp-agentRL/SCION-AR/tree/feat/sdk-only-v0.1.1)，后续 SDK 开发继续使用该分支。本轮没有创建 SDK PR，也没有合并到仓库 main。本地 main 中的共用修复尚未提交或推送。

上述 2026-10-05 历史记录中生成并验证的 0.1.1 安装包未发布到 npm，其验证范围不等于后续示例迁移的真实模型验收。当前仓库 example 已迁移为 main Git-off；用户现有课题和持久状态未自动迁移。后续正式分发时，应重新打包以包含最新代码、示例和说明文档。

- [详细 CLI/API 使用说明](main-cli-zh.md)
- [工作区和迁移说明](main-runtime-migration-zh.md)
- [10 月 6 日 workspace 与三 Harness 验收](workspace-main-acceptance-20261006-zh.md)
- [10 月 5 日 OAuth/Git/Evolver 历史验收](main-oauth-git-evolver-default-test-report-20261005.md)
