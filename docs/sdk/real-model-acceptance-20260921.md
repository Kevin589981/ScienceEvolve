# ScienceEvolve SDK 真实模型测试报告

> 历史记录：当前 SDK 已移除 legacy 引擎及其脚本；下文命令和结果仅对应当时版本。当前用法见 [CLI/API 手册](../../sdk/docs/main-cli-zh.md)。

> 历史证据说明：本页的历史实测命令、制品名、路径和来源链接按当时原文保留；正文中的当前接口名称已更新。新的命名与迁移边界见 [ScienceEvolve 改名记录](../renaming/EXECUTION.md)。

> 本文保留历史验收结果，名称已统一为当前 ScienceEvolve 命名；不表示命名调整后重新进行了真实模型验收。

> 测试日期：2026-09-21
>
> 测试性质：真实网关、真实模型、真实 Codex Harness、自定义 Agent/Workflow 端到端测试。
>
> 文档说明：本文保留 2026-09-21 的真实验收记录。随后已将当时仅存在于构建产物的兼容修复恢复到 TypeScript 源码并加入自动回归测试；本次源码重建没有再次发起收费模型请求，因此不把自动测试表述成新的真实模型验收。

## 0. 0.1.1 修复复验

在原始 0.1.0 测试之后，已把隔离验证中的 Codex 兼容修复和本次两项修复同步到 SDK 构建产物，并重新打包为：

```text
scion-ar-sdk-0.1.1.tgz（历史验收制品，不纳入 Git）
```

SHA256：

```text
584BD73D233AFFE4EA6166BB53DC99B42FB8F7563BFFD68A9A7935C7264BD495
```

本次以普通使用者方式运行了一个更复杂的两阶段自定义工作流：

```text
input → analyst → writer → finish
```

课题为：给 5 人高校科研团队制定六周算法短论文推进方案，要求覆盖研究假设、里程碑、分工、实验矩阵、失败判据、风险、交付物和资源裁剪。

最终结果：

- 项目状态：`completed`；
- 两个 Agent 均完成真实 Kimi 模型调用；
- 发布 2 个 Markdown 方案产物；
- `tokenUsage.totalTokens`：`137087`；
- `tokenUsage.inputTokens`：`124955`；
- `tokenUsage.outputTokens`：`12132`；
- 计量的模型调用次数：`2`；
- `fallback model metadata` 警告：`0`。
- 0.1.1 tarball 已在全新 consumer 目录安装，`createResearchSdk` 与 `validateWorkflowConfig` 可正常导入。

修复内容：

1. Responses → Chat Completions 的流式转发会请求 `stream_options.include_usage=true`，上游 usage 末帧能够进入 Codex `turn.completed`，再由 SDK 写入项目 `tokenUsage`；
2. SDK 为实际配置的 Kimi model 生成 Codex model metadata，并与当前 Codex 自带 catalog 合并，避免覆盖 Codex 内部需要的 fallback/辅助模型 metadata；
3. 同步保留 namespace 工具转换、编排 MCP 环境变量继承和控制桥 socket 错误保护。

以下章节保留原始 0.1.0 的测试经过，便于追踪问题是如何暴露和修复的。

## 1. 结论

本次真实测试最终成功，但成功结果是在隔离安装中补上三项兼容修复后取得的。

原始 `@scion-ar/sdk` 0.1.0 tarball 可以完成真实四阶段网关探测，但无法直接完成当前 Codex 0.155 的真实工作流。因此，当前 tarball 不能作为“已通过真实端到端验收”的正式交付包，需要先把本报告中的修复同步到 SDK 源码、增加回归测试、重新打包并再次验收。

最终验证结果：

- 创智 Kimi 模型真实请求成功；
- 四阶段探测全部通过；
- 自定义 `main + solver` 工作流成功创建；
- `solver` 完成真实模型调用；
- 计算结果正确：`17 × 23 = 391`；
- 逆运算验算正确；
- 模型真实调用编排控制 MCP；
- 产物成功发布；
- 展示产物成功选定；
- `complete_project` 成功提交；
- 自动终止成功；
- 最终项目状态为 `completed`；
- 共记录 78 个任务事件；
- 临时网关凭据目录已全部删除，确认残留为 0。

## 2. 测试环境

| 项目 | 内容 |
| --- | --- |
| SDK 包 | `@scion-ar/sdk` 0.1.0 |
| 原始 tarball SHA256 | `60F2F9C9CC163268C6D7FD896CFCCBA3C28760E2626BE7FF8FD8337796D7F829` |
| 操作系统 | Windows |
| Node.js | 24.20.0 |
| Harness | Codex CLI 0.155.0-alpha.9.2 |
| 网关 | `SII 2026 · Kimi-K2.7-Code` |
| 模型 | `Kimi-K2.7-Code` |
| 网关协议 | Chat Completions |
| Harness 原生协议 | Responses |
| 协议路由 | Responses → Chat Completions |
| SDK 数据目录 | 系统临时目录中的隔离 `dataDir` |

测试使用网页端已登记的网关凭据，但脚本和报告均不包含 API key。SDK 每次创建隔离临时目录，结束后删除；测试后再次扫描确认没有残留 `scion-ar-sdk-real-*` 目录。

## 3. 测试 Workflow

本次没有使用固定五 Agent 预设，而是定义了最小自定义流程：

```text
input → solver → finish
          │
          └─ automatic termination

main：保留为唯一系统协调 Agent
solver：完成计算、验算、发布产物并结束任务
```

主要配置：

- 自定义 Agent：`main`、`solver`；
- 输入目标：`solver`；
- `solver` 只有一条指向 `finish` 的弱边；
- 终止 Agent：`solver`；
- `termination.automatic: true`；
- Harness：Codex；
- model：`Kimi-K2.7-Code`；
- `reasoningEffort: low`；
- Web 搜索关闭；
- 不加载额外 Skill 和外部 MCP。

任务要求：

```text
计算 17 × 23。给出明确结果，并用除法逆运算验算，然后结束任务。
```

## 4. 最终四阶段探测结果

| 阶段 | 结果 | 耗时 | HTTP |
| --- | --- | ---: | ---: |
| 文本普通 | 通过 | 643 ms | 200 |
| 文本流式 | 通过 | 437 ms | 200 |
| 工具调用普通 | 通过 | 670 ms | 200 |
| 工具调用流式 | 通过 | 511 ms | 200 |
| 合计 | 通过 | 2262 ms | — |

这说明创智模型本身能够完成文本、流式和工具调用请求。后续工作流失败不是模型连接问题，而是 SDK 对新版 Codex 请求和 MCP 环境的兼容问题。

## 5. 原始 0.1.0 暴露的问题

### 5.1 不支持 Codex Responses namespace 工具

第一次真实工作流启动后，Codex 0.155 使用以下类型声明 MCP 工具：

```text
type: namespace
```

原始 SDK 协议代理只允许：

```text
function
custom
```

因此直接报错：

```text
Cannot route provider tool type namespace from responses
```

修复方式：

1. 把 namespace 内的函数转换为可移植的扁平工具名；
2. 保存原始 namespace 和函数名；
3. Chat Completions 返回工具调用后，恢复 Codex 期望的 namespace 结构；
4. 对历史 `function_call` 中的 namespace 做相同转换。

### 5.2 Codex 自动发送 `web_search` provider tool

即使 Agent 配置为：

```text
webSearch: false
```

Codex 0.155 仍会在 Responses 请求中附带 `web_search` provider tool。原始 SDK 将其视为不可转换类型并终止请求。

隔离补丁按照当前网页端协议路由行为处理：只转发可以安全转换的函数/namespace 工具，不把该 provider tool 发送到 Chat Completions 网关。

正式修复需要增加测试，明确区分：

- config 没有开启 Web 搜索时，Codex 自动附带的工具；
- 用户确实要求 Web 搜索，但目标网关协议不能兑现的情况。

后者必须明确报错，不能静默降级。

### 5.3 编排 MCP 没有显式继承控制环境变量

Codex 0.155 不再默认把以下环境变量传给 MCP 子进程：

```text
SCION_AR_CONTROL_CONTEXT
SCION_AR_CONTROL_CAPABILITY
```

导致 `scion-ar-orchestration-control` 启动后立即退出，Codex 日志显示 MCP 握手失败。

网页端代码已经使用 Codex MCP 配置的 `env_vars` 显式传递这两个变量，独立 SDK tarball 没有同步。

隔离补丁增加：

- `env_vars` 显式继承；
- `default_tools_approval_mode = "approve"`。

修复后 MCP 工具能够正常启动和调用。

### 5.4 控制桥 socket 错误未处理

在 MCP 不可用、模型尝试降级访问控制桥时，客户端提前关闭连接，服务端继续写入，触发：

```text
write ECONNABORTED
```

该 socket 没有 `error` 监听器，错误升级为未捕获异常并使整个测试进程退出。

隔离补丁为 Unix socket 和 Windows loopback fallback 都增加了错误处理，避免单个断开的客户端击穿 SDK 宿主进程。

## 6. 最终工作流结果

最终真实模型输出：

```text
17 × 23 = 391
391 ÷ 23 = 17
391 ÷ 17 = 23
```

模型随后完成了以下真实控制动作：

1. `publish_artifact`；
2. `select_display`；
3. `complete_project`。

任务事件包含：

```text
artifact.published
display.selected
control.action.committed
agent.completed
project.completed
invocation.completed
```

发布产物：

```text
calculation_result.md
```

最终状态：

```json
{
  "passed": true,
  "runStatus": "completed",
  "eventCount": 78,
  "invocations": 1,
  "artifacts": 1
}
```

### 6.1 不阻塞完成、但需要继续核对的观察项

- 任务发生了多轮真实模型请求，但最终 `tokenUsage` 仍全部为 0，说明当前协议路由或 Codex 事件中的 usage 没有进入 SDK 计量；
- Codex 日志出现 `Unknown model gpt-5.6-luna` 的 fallback metadata 警告，实际请求和网关使用的仍是 `Kimi-K2.7-Code`；
- PowerShell shell snapshot 不受 Codex 支持的警告不影响本次任务完成。

前两项不影响本次工作流功能结果，但正式用于成本统计和生产监控前需要补充验证。

## 7. 安全与清理

- 测试脚本不写入 API key；
- API key 只在运行时从网页端 GatewayStore 读取；
- SDK 使用独立临时 `dataDir`，不修改网页端项目数据；
- 测试日志和本报告均不包含密钥；
- 三次失败测试产生的临时目录已人工验证并删除；
- 最终成功测试由脚本在 `finally` 中自动删除临时目录；
- 测试结束后扫描结果：`scion-ar-sdk-real-*` 残留目录为 0；
- 没有残留 Codex 或 Node 测试子进程。

## 8. 交付判断

本次测试证明两件事：

1. 创智部署的 `Kimi-K2.7-Code` 可以支持 SDK 所需的真实文本、流式和工具调用能力；
2. 自定义 Agent/Workflow 在补齐 Codex 0.155 兼容后能够端到端完成。

但本次测试也证明：

> 当前原始 `scion-ar-sdk-0.1.0.tgz` 不能直接作为已通过真实验收的最终包。

当前源码 PR 的处理状态：

1. 已恢复独立 SDK 的 0.1.1 TypeScript 源码；
2. 已同步 namespace 工具转换，并恢复 Responses namespace；
3. 已明确忽略 Codex 自动附带且无法转译的 `web_search` provider tool；
4. 已给编排 MCP 配置 `env_vars` 和内部工具审批模式；
5. 已给 Unix socket 与 Windows loopback 控制桥增加错误保护；
6. 已增加协议、流式 usage、model catalog 和 MCP 配置回归测试；
7. 已通过源码 typecheck、单元测试、构建和独立安装 smoke test；
8. 仍需在准备正式发布制品时，用重新构建的 tarball 再跑一次收费模型验收；
9. tarball SHA256 属于发布制品记录，不作为 Git 源码版本的固定值。

## 9. 复现与回归文件

仓库内不保存本机网关配置、API key、运行数据或打过补丁的 `node_modules`。可复现检查位于：

- `sdk/tests/protocol-router-compatibility.test.ts`：namespace、流式 usage 和协议回程；
- `sdk/tests/fixtures/codex-process.mjs`：model catalog 与编排 MCP 配置；
- `sdk/scripts/package-smoke.mjs`：打包、隔离安装和独立 consumer 运行；
- `sdk/examples/run.mjs`：外部接入示例。

真实网关验收需要调用方在运行时提供自己的网关凭据；凭据不写入示例、测试报告或 Git。
