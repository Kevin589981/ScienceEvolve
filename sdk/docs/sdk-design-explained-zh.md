# ScienceEvolve 独立 SDK：通俗设计与实现说明

> 历史记录：legacy 引擎及其 API/CLI 入口已移除。下文保留旧版本设计与验收事实；当前用法见 [CLI/API 手册](main-cli-zh.md)。

> 本文面向第一次接触 SDK、Agent、Harness 和工作流编排的开发者。
>
> 本文主体记录 2026-09-23 的 legacy 设计，不是当前入口的操作手册。当前 SDK 0.1.1 默认采用 main 引擎、Node 24+；CLI/API 均支持 workspace，Git-off 原地执行，Git-on 从原项目导入并在正式完成后自动回写。新引擎不读取旧 dataDir。
>
> 当前使用方法请以 [main CLI/API 文档](main-cli-zh.md)、[迁移说明](main-runtime-migration-zh.md) 和 [工作目录样例](../examples/workspace-examples.md) 为准；旧 API 已移除。

## 1. 我们到底在做什么

ScienceEvolve 原本是一套带前端、HTTP Server 和本地执行逻辑的科研工作流应用。它能够把一个科研任务交给多个 Agent，例如：

- Main 负责理解用户目标、分配任务和判断是否结束；
- Idea 负责提出和优化研究思路；
- Execution 负责实验或计算；
- Writing 负责写作；
- Review 负责评审和提出修改意见。

驾驶舱 CLI 将来也需要运行同样的科研流程，但它不应该为了启动一个任务而先启动 ScienceEvolve 网页和 HTTP Server。

因此，本次工作的目标是把“读取配置、创建任务、编排 Agent、调用模型、保存状态、获取结果”包装成一个普通 Node.js 包：

```text
驾驶舱 CLI / Node 程序
          │
          ▼
   @scienceevolve/sdk
          │
          ├─ 读取并校验 config
          ├─ 编排 Agent 工作流
          ├─ 启动 Codex / pi / dsh / Claude Code
          ├─ 连接模型网关、Skill 和 MCP
          ├─ 保存任务状态和事件
          └─ 返回进度、结果和控制接口
```

简单地说：

> 以前只能“打开 ScienceEvolve 应用来跑科研任务”；现在其他程序可以“导入 SDK，传入 config，然后直接跑科研任务”。

## 2. SDK 是什么

SDK 是 Software Development Kit，即“给其他程序员调用的软件工具包”。

它不是一个页面。主要接口是一组可导入的函数，同时包内附带初版 `scienceevolve` 前台命令：

```js
import {
  createResearchSdk,
  loadWorkflowConfig
} from "@scienceevolve/sdk";
```

驾驶舱 CLI 可以调用这些函数，而不需要知道 ScienceEvolve 内部如何保存项目、如何调用 Harness、如何控制 Agent。包内 CLI 可直接用于本地试接，但不等于驾驶舱业务 CLI 已接入。

可以把两者理解为：

- CLI 是“操作面板”，负责读取用户命令、打印进度；
- SDK 是“发动机”，负责真正运行工作流；
- config 是“装配图”，描述有哪些 Agent、它们使用什么模型，以及如何流转。

## 3. 当前边界：SDK 独立交付，与 Web/Server 对齐语义

当前采用的是“独立 SDK 包”方案：

- SDK 位于仓库的 `sdk/` workspace；
- SDK 可以打包成 `.tgz`，在仓库外安装；
- SDK 不需要 ScienceEvolve Web 或 Express Server；
- SDK 分支只保留 SDK；ScienceEvolve 的 `server/src` 和 Web 保留在 `main` 分支；
- 驾驶舱后续直接依赖 SDK 的公开 API。

这样做的优点是：

- 驾驶舱可以独立选择和锁定 SDK 版本；
- SDK 旧版本可以继续使用，不会被 ScienceEvolve 后续修改自动改变；
- 打包后的 SDK 不需要访问 ScienceEvolve 源码目录。

两个 Git 分支不能在运行时互相读取源码，因此宿主各自包含一份可独立构建的实现。当前把工作流合同、Main capability、Loop、活动超时、Token 账本、Session 恢复、Gateway reasoning 和 Main 编排策略放在同接口、同内容的 shared core 中，并用源码指纹与跨宿主黄金轨迹防止静默分叉。后续公共修改仍需作为功能级 commit 显式同步、升级和测试，不会因为名称相同而自动传播。完整合同见 [main / SDK 功能一致性与宿主边界](main-sdk-parity-zh.md)。

## 4. SDK 的总体结构

SDK 从外到内分成五层：

```text
公开 API 层
  createResearchSdk / start / events / gateways
                         │
配置层                   ▼
  loadWorkflowConfig / validateWorkflowConfig / 默认值与规范化
                         │
运行时和编排层           ▼
  Runtime / Orchestrator / Scheduler / Storage / EventHub
                         │
Harness 适配层           ▼
  Codex / pi / dsh / Claude Code / 协议转换 / MCP 控制
                         │
外部系统                 ▼
  模型网关 / Skill / MCP Server / Inspire compute / 文件系统
```

各层职责如下。

### 4.1 公开 API 层

公开入口主要在 `sdk/src/index.ts` 和 `sdk/src/client.ts`。

调用方只需要使用稳定的高层接口：

- 创建 SDK；
- 加载 config；
- 注册和测试网关；
- 启动任务；
- 监听事件；
- 暂停、恢复、取消或补充输入；
- 查询结果；
- 关闭 SDK。

调用方不需要直接实例化 Orchestrator、Storage 或 Runner。

### 4.2 配置层

配置层负责把 JSON 转成一个确定的 `WorkflowConfig`：

```ts
interface WorkflowConfig {
  agents: Record<string, WorkflowAgentConfig>;
  orchestration: AgentOrchestrationTemplate;
}
```

它完成三件事：

1. 检查字段格式和未知字段；
2. 应用模板默认值和系统不变量；
3. 检查 Agent、路由和终止条件之间的引用关系。

### 4.3 运行时和编排层

这一层是真正的“科研任务发动机”。

它负责：

- 创建并持久化任务；
- 决定下一个运行哪个 Agent；
- 构建 Agent inbox 和上下文；
- 保存 Agent 交接结果；
- 处理弱分支、强边和循环；
- 处理 Main 的路由和完成决定；
- 在进程退出后恢复检查点；
- 发出实时事件；
- 处理取消、暂停和补充输入。

### 4.4 Harness 适配层

Harness 可以理解为“真正和模型交互的 Agent CLI”。

SDK 当前适配：

- Codex；
- pi；
- dsh；
- Claude Code。

不同 Harness 使用的参数、配置目录、权限模型和 API 协议不同，因此 SDK 不能只换一个命令名。适配层需要把统一的 Agent 配置翻译成各自的 CLI 参数和运行环境。

### 4.5 外部系统层

SDK 自己不提供大模型、搜索服务、远程算力和第三方 MCP。它只负责安全、明确地连接调用方配置的外部能力。

## 5. config 如何描述一个工作流

SDK 沿用 ScienceEvolve 已有的 `agents + orchestration` config，没有重新发明另一套工作流语言。

一个简化的自定义配置如下：

```json
{
  "schemaVersion": 2,
  "name": "研究与评审流程",
  "agents": {
    "main": {
      "harness": "codex",
      "model": "model-a",
      "permission": "yolo"
    },
    "researcher": {
      "harness": "pi",
      "model": "model-a",
      "permission": "yolo",
      "skills": ["builtin:ccf-literature-searcher"]
    },
    "reviewer": {
      "harness": "claude-code",
      "model": "model-b",
      "permission": "workspace",
      "webSearch": true
    }
  },
  "orchestration": {
    "agents": [
      { "name": "main", "template": "main" },
      { "name": "researcher", "template": "idea" },
      { "name": "reviewer", "template": "review" }
    ],
    "input": { "source": "input", "target": "researcher" },
    "routes": {
      "main": [],
      "researcher": [
        { "target": "reviewer", "kind": "strong" }
      ],
      "reviewer": [
        { "target": "researcher", "kind": "weak" },
        { "target": "finish", "kind": "weak" }
      ]
    },
    "decisionPlans": {
      "main": "协调任务并判断是否完成",
      "researcher": "完成研究后交给 reviewer",
      "reviewer": "判断继续修改还是完成"
    },
    "allowUserIntervention": true,
    "termination": {
      "agent": "reviewer",
      "condition": "研究结果已经满足用户要求，且没有未解决的关键问题",
      "decisionBy": "main",
      "automatic": false
    },
    "resultFormat": {
      "presets": ["研究报告"],
      "custom": "附带证据列表和风险说明"
    }
  }
}
```

工作流不包含 Gateway ID、URL、key、profile 路径或运行快照。它只用 `gatewaySource` 选择 `env/profile`，并可用 `gatewayReasoningOption` 选择用户预先配置的思考选项；SDK 再按 Harness 读取环境变量或原生 profile。详见 [网关配置](harness-gateway-zh.md)。

## 6. Agent 配置具体怎样生效

每个 Agent 可以配置以下运行字段。

### 6.1 `model`

指定实际调用的模型。

启动任务前，SDK 会确认：

- model 存在于所选网关的模型列表；
- 该 model 和 Harness 已经完成连接测试；
- 测试使用的协议和当前运行协议一致。

### 6.2 `harness`

决定使用哪一种 CLI。可选值为：

```text
codex | pi | dsh | claude-code
```

省略时默认使用 Codex。

### 6.3 Harness 网关绑定

网关 ID 只存于内部运行状态，不允许在 workflow 中编辑；网关来自 Harness 对应环境变量或原生 profile。

SDK 不允许 config 直接携带 `apiKey` 或运行时 `gatewaySnapshot`。密钥保存在私有运行目录中，并只注入本次 Agent 子进程。

### 6.4 `instructions`

这是 Agent 的长期职责说明，例如“负责核对论文中的引用”。

它会进入 Agent mandate，但不能覆盖：

- 用户最新需求；
- 权限和安全约束；
- 服务端生成的路由候选；
- 工具调用协议。

### 6.5 `skills` 与 `autoSkills`

- `skills` 是本次 Agent 必须加载的固定 Skill；
- `autoSkills` 是可根据任务选择使用的候选 Skill。

SDK 解决了两个容易出错的问题：

1. config 中 `./`、`../` 开头的 Skill 路径以 config 文件目录为基准，不依赖 CLI 当前目录；
2. 外部 Harness 可能不能读取 SDK 安装目录，因此 SDK 会把所选 Skill 和依赖文件复制到 Agent 工作区，再把工作区内路径交给 Harness。

内存对象没有 config 文件目录。如果使用相对 Skill 路径，必须显式提供：

```js
validateWorkflowConfig(config, {
  baseDir: "/absolute/config/directory"
});
```

### 6.6 `mcpServers`

MCP Server 可以给 Agent 提供额外工具，例如文献查询、领域数据库或认证服务。

统一 config 形式为：

```json
{
  "name": "literature",
  "url": "https://mcp.example.com/server"
}
```

不同 Harness 的接入方式不同：

- Codex：写入调用级 HTTP MCP 配置；
- pi：通过 SDK 内置的官方 MCP 客户端扩展；
- dsh、Claude Code：通过调用级 HTTP 到 stdio 桥；
- ScienceEvolve 固定 MCP：从 `SCIENCEEVOLVE_FIXED_MCP_TOKEN` 读取凭据。

固定 MCP 缺少凭据时，SDK 会在创建任务前报错，不会让 Agent 在没有工具的情况下继续运行。

Workflow 顶层还可以定义版本化的 `mcpDefinitions`，Agent 通过 `{ "name": "task-tools", "project": "definition-name" }` 引用。SDK 保存完整源码、entrypoint、command/args 和只含宿主环境变量名称的 `envFrom`，每次调用启动私有 stdio MCP 进程，并在完成、失败或取消后回收。对应的 `skillDefinitions` 保存包含非空 `SKILL.md` 的完整任务 Skill 文件映射，Agent 用 `project:<name>` 分配。两类定义与引用一起校验、原子提交，不允许内联凭据。

### 6.7 `reasoningEffort`

支持：

```text
low | medium | high | xhigh
```

这是 Harness 原生思考深度，传给对应 CLI。它不再被猜测为某个 Gateway 的请求字段，因为不同 Gateway 即使使用同一协议，也可能要求完全不同的路径和值。

### 6.8 `gatewayReasoningOption`

Gateway reasoning 由部署者按 Gateway/model 配置参数路径与候选值，Agent 只选择 option ID。支持的路径为 `reasoning_effort`、`reasoning.effort`、`chat_template_kwargs.reasoning_effort` 和 `thinking.effort`。未选择时不发送字段；映射或选项变化会使旧探测失效。它和 `reasoningEffort` 相互独立，也不允许 Main 在运行中修改。详见 [Gateway reasoning](harness-gateway-zh.md#gateway-reasoning)。

### 6.9 `permission`

权限可选：

- `workspace`：只能在工作区范围内工作；
- `compute`：允许使用 Inspire/计算环境；
- `yolo`：允许更宽的本地执行能力。

SDK 不会把一个 Harness 不支持的权限偷偷换成别的权限。无法兑现时会在任务创建前报错。

### 6.10 `webSearch`

决定 Agent 是否获得 Web 搜索能力。

四种 Harness 都可使用调用级本地 Web MCP 工具。工具通过所选网关/模型的原生搜索接口执行；`web_fetch` 仅允许通过公网 HTTPS 访问，内网地址会被拒绝。具体网关或模型若不支持原生搜索，工具会返回明确错误。

### 6.11 `sessionPersistence`

决定同一 Agent 后续调用是否恢复之前的会话。

Codex、pi 和 Claude Code支持；当前 dsh headless 每次创建新会话，不能兑现该字段，因此 `dsh + sessionPersistence: true` 会被拒绝。

### 6.12 `decisionBy`

它决定普通弱分支由谁选择：

- `main`：交给 Main；
- `agent`：当前 Worker 可以在自己的多个普通弱边中选择。

Main 自身的该字段始终规范化为 `main`。

## 7. 工作流路由怎样执行

### 7.1 输入节点

`orchestration.input.target` 决定第一个运行的 Agent。

### 7.2 强边

强边表示确定的下一步：

```json
[{ "target": "reviewer", "kind": "strong" }]
```

一个 Agent 只要有强边，它必须是唯一出边。完成后 SDK 直接排队目标 Agent。

### 7.3 弱边

弱边表示多个合法候选：

```json
[
  { "target": "researcher", "kind": "weak" },
  { "target": "finish", "kind": "weak" }
]
```

SDK 会结合 `decisionBy`、`decisionPlans` 和当前任务状态，让 Main 或当前 Agent 选择一条。

### 7.4 循环

`orchestration.loops` 把一条确定的强返回边定义为有界循环组：

```json
{
  "id": "refinement",
  "from": "reviewer",
  "to": "researcher",
  "maxIterations": 3,
  "exitTo": "main"
}
```

`to` 是入口，`from` 是组尾，`maxIterations` 是每批次数，`exitTo` 是批次耗尽后的目标。SDK 分别持久化当前批迭代数、批次号和累计次数；暂停、恢复、失败重试和普通重配置不会重置。批次返回 Main 时由 Main 判断结束、进入新批或改走其他 Agent，但仍不能绕过原终止条件。完整拓扑约束见 [通用循环组](workflow-loops-zh.md)。

### 7.5 Main 的特殊规则

Main 是系统控制 Agent：

- 每个工作流必须有且只有一个 `main`；
- Main 的模板固定为 `main`；
- Main 的出边会自动重建为指向全部 Worker 的弱边；
- Main 的会话持久化固定开启；
- Main 的普通路由决定不能委托给其他 Agent。

因此，config 中手写的 Main 出边不会原样保留。这是明确的系统规范化，不是运行时偷偷覆盖。

Main 每轮只有两种控制模式。`autonomous` 用于初始输入、确定路由、终止验收、故障/用户输入、Loop 批次返回和重配置续跑，可以调度任意普通 Agent；`weak-branch` 只处理来源 Agent 的多个弱边，只能选择本轮候选。完成、请求用户和动态重配置是同一 capability 快照上的独立权限。弱分支选择 `finish` 只会安排新的 autonomous 终止验收，不会在受限轮直接完成。

Main 系统 Prompt 还常驻根任务编排策略，要求它核验真实文件、测试、状态和日志后再整合完成；Worker 报告只提供证据索引，不自动成为事实或用户授权。该策略不是需要配置的 Skill，普通 Worker 不会获得。

### 7.6 Main 动态重配置

`orchestration.allowMainReconfiguration` 默认关闭，只能由用户在运行前开启。开启后，具有 `canReconfigure` capability 的 autonomous Main 会在共享 Workspace 中收到 `workflow.json`，可修改 Agent 名单、输入、路由、Loop、终止、结果形式、用户介入、instructions、model、Harness、`gatewaySource`、Bash proxy、Skills/MCP 以及 Project Skill/MCP 定义。Main 编辑文件后必须调用 `apply_workflow`，只改文件不会生效。

授权开关、permission、Web Search、Session/弱边决策策略、Harness `reasoningEffort`、Gateway reasoning、凭据和运行快照保持锁定。SDK 用 base hash 拒绝过期快照，先校验完整提案，再通过 invocation journal 原子提交；任一错误都不会部分覆盖当前 Workflow。成功后仅刷新受影响的 Session。

## 8. 终止条件和自动终止

终止配置示例：

```json
{
  "agent": "reviewer",
  "condition": "结果满足用户要求且没有关键问题",
  "decisionBy": "main",
  "automatic": false
}
```

`condition` 是自然语言条件，会进入 Agent 和 Main 的上下文，不是 JavaScript 表达式。

### 8.1 `automatic: false`

终止 Agent 完成后，SDK 将任务交给 Main。Main 检查当前证据和终止条件，然后选择：

- 继续安排 Agent；
- 请求用户补充信息；
- 调用 `complete_project` 完成任务。

### 8.2 `automatic: true`

指定的非 Main 终止 Agent在拥有 `finish` 出边时，会获得受限的：

- `select_display`；
- `complete_project`。

它可以根据自然语言终止条件直接完成任务，不需要再运行一次 Main。

安全限制包括：

- 只有配置中的终止 Agent能获得权限；
- 必须存在合法 `finish` 边；
- 控制动作绑定当前项目、Agent、调用 ID 和状态版本；
- 能力带短期有效期和哈希校验；
- 普通 Worker 即使伪造返回内容也会被运行时拒绝；
- 已发布成果存在时，必须先选择有效展示文件。

## 9. 四种 Harness 当前支持范围

| 能力 | Codex | pi | dsh | Claude Code |
| --- | --- | --- | --- | --- |
| workspace 权限 | 支持 | 当前不支持 | 支持 | 支持 |
| compute/Inspire | 支持 | 不支持 | 不支持 | 不支持 |
| yolo | 支持 | 支持 | 支持 | 支持 |
| Web 搜索 | 支持 | 当前不支持 | 当前不支持 | 支持 |
| 会话恢复 | 支持 | 支持 | 当前不支持 | 支持 |
| Skill | 工作区暂存 + 原生配置 | 工作区暂存 + `--skill` | 工作区暂存 + prompt | 工作区暂存 + prompt |
| HTTP MCP | 原生配置 | MCP 客户端扩展 | HTTP→stdio 桥 | HTTP→stdio 桥 |
| reasoning effort | 支持 | 支持 | 支持 | 支持 |

这里的“不支持”不会静默降级。例如，给 pi 配置 `workspace`，SDK 会告诉调用方当前无法强制执行 Pi 工作区沙箱，并要求明确调整 config。

## 10. 模型协议转换

四个 Harness 的原生 API 协议不同：

- Codex：Responses；
- pi、dsh：Chat Completions；
- Claude Code：Anthropic Messages。

网关也可能只提供其中一种协议。

当二者不一致时，SDK 会为本次调用启动回环协议代理：

```text
Claude Code
    │ Anthropic Messages
    ▼
本地调用级协议代理
    │ Chat Completions
    ▼
用户配置的模型网关
```

代理负责转换：

- 消息角色和内容；
- 工具定义；
- 工具选择；
- 普通响应；
- SSE 流式事件；
- 工具调用参数；
- reasoning 配置；
- 网关错误。

代理只绑定回环地址，使用一次性 token，并在当前 Agent 调用结束后关闭。上游真实网关密钥不会直接交给不需要它的本地进程。

## 11. 为什么启动前必须做网关探测

“HTTP 能返回 200”不等于 Agent 工作流一定能运行。

SDK 的网关测试包括：

1. 文本普通响应；
2. 文本流式响应；
3. 工具调用普通响应；
4. 工具调用流式响应。

工具调用尤其重要，因为工作流依赖模型调用路由、发布成果、请求用户和完成项目等控制工具。

启动任务时，SDK 会检查当前：

- Harness；
- model；
- 网关协议；
- 原生协议；
- 是否经过协议代理；
- 最近测试结果。

修改网关后，旧测试不会被当成当前配置的有效证据。

## 12. 任务如何被控制

创建任务：

```js
const run = await sdk.start({
  title: "研究课题",
  requirement: "分析……并形成报告",
  workflow
});
```

### 12.1 查看状态

```js
const snapshot = await run.snapshot();
```

公共状态不包含网关密钥、Agent 完整运行快照或控制 capability。

### 12.2 实时事件

```js
for await (const event of run.events()) {
  console.log(event.seq, event.type, event.message);
}
```

事件有任务内递增的 `seq`，支持断线后从指定序号继续读取：

```js
run.events({ afterSeq: lastSeq });
```

### 12.3 等待任务

```js
const result = await run.wait();
```

`wait()` 在以下稳定状态返回：

- completed；
- cancelled；
- paused；
- interrupted。

它不是“只等待成功”。调用方必须检查 `result.status`。

### 12.4 暂停和恢复

```js
await run.pause();
await run.resume();
```

暂停通常在当前 Agent 的安全边界生效，不会随意截断一次已经提交的状态变更。

### 12.5 取消

```js
await run.cancel();
await run.wait();
```

取消会终止本地调用并将任务状态落稳。远端已经提交的外部算力是否能撤销，仍取决于外部系统能力。

### 12.6 补充输入

等待当前 Agent 完成后再处理：

```js
await run.addInput("补充考虑数据隐私", {
  mode: "wait",
  requestId: "input-001"
});
```

立即中断当前调用，由 Main 根据检查点重新判断：

```js
await run.addInput("停止当前方向，改做方案 B", {
  mode: "interrupt",
  requestId: "input-002"
});
```

`requestId` 用于幂等重试，避免网络重发导致同一条输入被加入两次。

### 12.7 回答 Agent 问题

当 Main 请求用户确认时：

```js
await run.respond("确认使用公开数据集");
```

这和 `resume()` 不同。存在待回答问题时，必须使用 `respond()`。

## 13. 持久化和恢复

`dataDir` 是 SDK 的存储根目录，默认由 SDK 使用用户主目录下的 `.scienceevolve/data/`。每个任务自动分配独立的 `projects/prj_xxx/`，调用方无需传入目录；需要自定义位置时可设置 API `dataDir` 或环境变量 `SCIENCEEVOLVE_DATA_DIR`。其中保存：

- 网关配置；
- 项目状态；
- 事件日志；
- 所有 Agent 共用的业务 Workspace 与 `Memory.md`；
- 会话 ID；
- 交接内容；
- 已发布成果元数据。

调用方可通过 `sdk.start({ workspace: "/absolute/path" })` 选择一个已存在且与 `dataDir` 分离的目录；未指定时使用项目的 `workspaces/`。所有 Agent 直接在同一文件树中协作，Session、调用日志与临时目录仍按身份隔离。旧版 `<agent>/shared/` 文件原地保留，不合并、不覆盖。

`publish_artifact` 在登记时绑定文件大小、mtime、producer、invocation、media type 与 SHA-256。后续预览、展示和读取会重新校验；文件变更后必须重新发布。没有 hash 的旧记录保持 legacy/unverified，不会被当成可信成果。

SDK 对该目录加排他锁：同一时间只能有一个 SDK 或 ScienceEvolve 实例打开同一目录。

原因是两个进程同时修改一个任务可能造成：

- 同一个 Agent 被启动两次；
- 事件序号冲突；
- 一个进程覆盖另一个进程的检查点；
- 同一控制动作被重复提交。

SDK 重新打开目录时会读取历史任务，但默认不会自动继续模型调用。调用方必须明确执行：

```js
const run = await sdk.getRun(runId);
await run.resume();
```

## 14. 安全设计

### 14.1 密钥不进入 workflow config

config 不记录 Gateway ID、URL、key、profile 路径或运行快照；只允许无凭据的 `gatewaySource` 和 `gatewayReasoningOption` 选择器。网关密钥保存在运行目录，并在启动时形成任务级快照。

### 14.2 子进程只得到当前需要的凭据

SDK 会清理无关提供商环境变量，只把当前 Agent 的网关凭据放入当前 Harness 子进程。

### 14.3 事件和公共 DTO 脱敏

公开错误、事件和任务快照会过滤：

- API key；
- Authorization；
- access/refresh token；
- gateway runtime snapshot；
- 内部 capability。

### 14.4 控制动作不能只靠模型文字

模型在最终回答中说“项目完成”并不会改变任务状态。

真正的状态变化必须通过能力受限的控制工具提交，例如：

- `route_to_agent`；
- `publish_artifact`；
- `select_display`；
- `request_user`；
- `apply_workflow`；
- `complete_project`。

运行时再次校验调用身份、候选路由、任务版本、工具权限和成果路径，然后才原子提交。

### 14.5 config 是受信任的执行输入

SDK 可以限制结构和权限，但不能把未知来源的 config 变成绝对安全的沙箱。

config 中的：

- Agent instructions；
- Skill；
- MCP Server；
- yolo 权限；
- compute 配置

都可能导致文件、网络或命令操作。因此驾驶舱应把 config 当成代码级别的受信任输入，不能直接运行任意用户上传的配置。

## 15. 最小调用示例

```js
import {
  createResearchSdk,
  loadWorkflowConfig
} from "@scienceevolve/sdk";

// gatewaySource=profile 时默认读取 Harness 原生位置，可设置 SDK_CODEX_PROFILE 指定路径。

const sdk = await createResearchSdk({
  harnesses: {
    codex: {
      executable: "D:/tools/codex.exe"
    }
  }
});

try {
  // gatewaySource=env 时，SDK 创建前设置对应 Harness 的 key/URL 环境变量。
  const workflow = await loadWorkflowConfig(
    "D:/cockpit-config/workflow.json"
  );
  // 模型和 Harness 直接使用 workflow 中各 Agent 的 model / harness 配置。

  const run = await sdk.start({
    title: "科研任务",
    requirement: "研究指定问题并输出带证据的报告",
    workflow
  });

  for await (const event of run.events()) {
    console.log(`[${event.seq}] ${event.type}: ${event.message}`);
  }

  const result = await run.wait();
  console.log(result.status, result.artifacts);
} finally {
  await sdk.close();
}
```

完整示例位于 `sdk/examples/README.md`。

## 16. Windows 下 Harness 入口怎样配置

SDK 不通过 shell 启动 `.cmd`、`.bat`、`.ps1` 或 `.sh`，因为这会带来转义、窗口、信号和进程树清理问题。

`pi` 是 SDK 管理的 npm 依赖。默认情况下 SDK 会解析其版本化 JavaScript CLI，并使用当前 `node.exe` 启动，因此 Windows 调用方无需再安装或配置 `pi`。只有需要覆盖 SDK 管理版本时才传入下面的显式配置。

如果 CLI 是 JavaScript，可以使用：

```js
harnesses: {
  pi: {
    executable: "C:/Program Files/nodejs/node.exe",
    args: ["D:/tools/pi/dist/cli.js"]
  }
}
```

如果 CLI 提供原生 exe：

```js
harnesses: {
  "claude-code": {
    executable: "D:/tools/claude.exe"
  }
}
```

这样 SDK 能直接持有子进程句柄，并正确处理取消和退出。

## 17. 如何打包并在仓库外使用

在仓库根目录执行：

```sh
npm install
npm run typecheck:sdk
npm run test:sdk
npm run build:sdk
npm pack -w sdk
```

然后在驾驶舱或其他项目中安装：

```sh
npm install /absolute/path/scienceevolve-sdk-0.1.1.tgz
```

tarball 中包含：

- 编译后的 JavaScript；
- TypeScript 类型；
- 内置 Skill 和依赖资源；
- MCP/控制助手；
- 示例；
- README 和配置审计文档。

不包含：

- ScienceEvolve Server/Web 源码；
- 用户任务数据；
- 网关密钥；
- 本地 Harness 安装目录（SDK 管理的 `pi` 由 npm 依赖解析，不复制进 tarball）；
- `.env`；
- 开发缓存。

当前包设为 `private`，适合内部 tarball 分发，尚未发布到公共 npm registry。

## 18. 已完成的验证

当前已完成：

- SDK TypeScript 类型检查；
- 默认五 Agent、自定义 Agent、强边与 Main 两态权限模拟执行；
- 通用 Loop 的批次/迭代/累计计数、暂停恢复、重试和跨宿主黄金轨迹；
- 手动/自动终止差异；
- 共享 Workspace 与 Artifact SHA-256 失效/重新发布；
- 高级动态重配置、Project Skill/MCP 版本和回滚；
- 暂停、恢复、取消、补充输入和用户回答；
- 网关探测、model-specific reasoning 映射与指纹失效；
- 模型/工具活动窗口、请求级 Token ledger 与 Session 恢复幂等；
- MCP 命名、进程回收和凭据边界；
- 外部与 Project Skill 工作区暂存；
- config 相对 Skill 路径；
- 数据目录锁和历史恢复；
- npm pack；
- 仓库外安装和确定性 API/CLI consumer smoke（不调用收费模型）。

## 19. 尚未完成或不能过度承诺的部分

### 19.1 真实四 Harness × 模型矩阵

同步前在 Windows 做过创智网关的四 Harness/两模型真实探测，以及部分真实工作流和已安装 CLI 验收；结果与失败项见仓库的 `docs/sdk/real-acceptance-20260923.md`。这些不能外推到所有模型/协议，也不能证明**本轮主线同步后**的代码已经通过真实模型验收。

### 19.2 macOS 实测

当前本机是 Windows。macOS/Linux 上的路径、进程树、可执行入口和权限需要在相应真实环境验收。

### 19.3 正式驾驶舱 CLI

SDK、调用示例和初版 `scienceevolve` 前台 CLI 已存在，但驾驶舱正式 CLI 尚未接入。驾驶舱需要决定：

- config 文件位置；
- dataDir 生命周期；
- 密钥从哪里读取；
- 终端进度怎样展示；
- 用户确认和补充输入怎样交互；
- SDK 版本如何锁定和升级。

### 19.4 SDK 与 ScienceEvolve 的长期同步

2026-09-26 已按功能语义完成本轮 `main` / SDK 对齐。两边仍是独立分支和独立产物，不整体 merge；共同的合同、Main Prompt 策略、公共服务和黄金向量以相同内容保存在各宿主，并由源码指纹与确定性黑盒轨迹约束。后续仍需明确：

- 公共修复如何以同主题功能 commit 同步到两个分支；
- 谁负责 SDK 发版；
- config 合同如何做版本兼容；
- 驾驶舱何时升级 SDK；
- 旧 SDK 版本的支持周期。

具体公共边界、宿主差异和迁移规则见 [main / SDK 功能一致性与宿主边界](main-sdk-parity-zh.md)。

### 19.5 内置 Skill 许可与依赖审计

tarball 携带内置 Skill 及资源，对外分发前仍需确认许可、体积和依赖安全要求。

## 20. 代码位置速查

| 内容 | 位置 |
| --- | --- |
| SDK 公开导出 | `sdk/src/index.ts` |
| SDK 客户端 API | `sdk/src/client.ts` |
| config 加载与校验 | `sdk/src/config.ts` |
| SDK 运行时组装 | `sdk/src/runtime.ts` |
| Agent 编排器 | `sdk/src/internal/orchestrator.ts` |
| 跨宿主公共核心 | `sdk/src/internal/shared/` |
| 四 Harness 适配 | `sdk/src/internal/multi-harness-runner.ts` |
| Codex 适配 | `sdk/src/internal/codex-runner.ts` |
| 协议转换 | `sdk/src/internal/protocol-router.ts` |
| MCP 配置 | `sdk/src/internal/configured-mcp.ts` |
| 自动终止/控制工具 | `sdk/src/internal/orchestration-control-mcp.ts` |
| 工作流校验 | `sdk/src/internal/validation.ts` |
| 项目持久化 | `sdk/src/internal/storage.ts` |
| 生命周期测试 | `sdk/tests/sdk.test.ts` |
| config/Harness 测试 | `sdk/tests/config-compatibility.test.ts` |
| 可运行示例 | `sdk/examples/README.md` |
| 逐字段审计 | `sdk/docs/config-field-audit.md` |

## 21. 一句话总结

这次工作不是“又写了一个 ScienceEvolve 页面”，也不是“把 ScienceEvolve 全部改造成 SDK”。

真正完成的是：

> 将 ScienceEvolve 已有的科研 Agent 配置和执行方式，包装成一个可由驾驶舱 CLI 独立安装、通过 config 启动、可以观察和控制任务的 Node.js SDK；同时明确每个字段和 Harness 能否真正执行，不能执行的组合在启动前明确报错。
