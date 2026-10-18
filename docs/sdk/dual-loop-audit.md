# 双闭环与内部自进化：实现核对

当前说明更新日期：2026-10-14。默认 `@scienceevolve/sdk` 与 CLI 使用固定 main 内核；本页先说明当前机制，再保留 2026-09-25 的 legacy 核对记录。

## 默认 main 引擎

两张图表达任务反馈、批次交接、流程修改和内部 Evolver 自修改。当前 Evolver 是工作流内部获得重配置授权的 `main` Agent；图中的职责划分不要求额外创建一个名为 evolver 的 Worker。

| 图中机制 | 当前默认 main 的实现 | 代码与测试入口 |
| --- | --- | --- |
| Task 执行与反馈 | Worker 在任务目录执行、记录真实输出并交接，后续角色依据反馈改进方法 | [AHE 模板](../../example/01-ahe-evolve/workflow.json)、[实际 main 调度测试](../../sdk/tests/main-loops.test.ts) |
| 批次交给 Evolver | Git-off Loop 达到每批预算后进入 exitTo；AHE 由 Main 判断继续或结束，计数保留 | [Loop 与恢复测试](../../sdk/tests/main-loops.test.ts) |
| Evolver 位于工作流内部 | Main 与普通 Agent 一起属于流程，但控制动作受本轮 capability 和运行前授权约束 | [编排执行器](../../sdk/src/core/orchestrator.ts) |
| 修改流程及自身配置 | Main 编辑运行时提案并调用 apply_workflow；允许字段由 editableFields、lockedRuntime 和内核校验决定 | [提案与字段校验](../../sdk/src/core/agent-orchestration-reconfiguration.ts) |
| 新增任务资源 | Main 可新增 Project Skill/MCP 定义并调整 Agent 引用；已接受定义不可同名改写、替换或删除 | [资源约束](../../sdk/src/core/agent-orchestration-reconfiguration.ts)、[Project MCP](../../sdk/src/core/project-mcp.ts) |
| 应用修改后续跑 | 接受配置后继续调度，按原生会话连续性规则使用新指令；普通修改不等同于清空历史 | [Main/Worker prompt 自修改测试](../../sdk/tests/main-loops.test.ts) |
| 暂停与恢复 | Git-off Ctrl+C/SIGTERM 请求安全暂停；同一 dataDir 重开后恢复，保留批次与已完成历史 | [当前 CLI](../../sdk/cli/main-cli.mjs)、[暂停重开测试](../../sdk/tests/main-loops.test.ts) |

使用时需要满足以下约束：

1. 运行前由用户开启 `orchestration.allowMainReconfiguration`；只有获准的 autonomous Main 轮次获得 `apply_workflow`，Main 不能改变自己的授权开关。
2. 使用本轮 Inbox 指定的实际提案路径。外部 Git-off workspace 使用 `.scienceevolve/management/<projectId>/proposal/workflow.json`；`apply_workflow` 的 `path: "workflow.json"` 是逻辑别名，用户根目录配置保留。
3. 运行时提案与用户编写的启动 workflow 是不同文档。启动配置不携带 gatewayId、profile 路径或凭据；部署提供网关绑定，提案只允许在运行时已配置的路线和字段范围内调整。
4. `permission`、Web Search、会话持久策略、Harness/Gateway reasoning、凭据和授权开关保持锁定。`experimentMcp` 与 `decisionBy` 可按当前提案修改，工具选择仍受角色和宿主能力约束。
5. 配置合法性与科研收益分别验证。内核负责版本、授权、提交和恢复；实际方法与流程是否改善，需要真实任务评估。下列 legacy 测试数字不代表本轮执行结果。

当前测试文件覆盖批次、Main/Worker 指令修改、权限越界拒绝、暂停重开及迁移后的 AHE/软件模板；模型响应使用显式夹具。这些测试入口用于核对机制，不能替代真实模型、GPU 或湿实验验收。部署和命令见 [当前 CLI/API 手册](../../sdk/docs/main-cli-zh.md)，内核来源与兼容说明见 [2026-10-13 同步记录](../../sdk/docs/main-sync-20261013-zh.md)。

## 历史：2026-09-25 legacy 核对

检查日期：2026-09-25。以下实现路径、可编辑字段和测试数字属于当时的 legacy 内核；当前默认 main 请以上一节和当前手册为准。

当时结论：legacy SDK 支持两张图表达的任务反馈、批次交接、工作流修改和内部 Evolver 自修改机制，Evolver 对应 workflow 内的 `main` Agent。“进化”表示依据反馈提出并应用修改，其实际收益由任务评估验证。

### 图与 legacy 代码的对应关系

| 图中内容 | 当前实现 | 代码与验证 |
| --- | --- | --- |
| Task 提供执行结果 | Agent 在指定 workspace 中执行已有任务代码，保存输出并交接；AHE 模板由 execute 执行、judge 评估 | [AHE workflow](../../example/01-ahe-evolve/workflow.json)、[共享 workspace](../../sdk/src/internal/storage.ts) |
| research workflow 给出方法 | optimizer 读取需求与已有证据，修改任务代码；SDK 按强边调度下一次 execute | [AHE workflow](../../example/01-ahe-evolve/workflow.json)、[调度器](../../sdk/src/internal/orchestrator.ts) |
| 本轮研究结束后交 Evolver | 循环组达到 maxIterations 后，执行器自动调度 exitTo；AHE 配置为 main | [循环配置及测试](../../sdk/tests/workflow-loops.test.ts) |
| Evolver 修改研究过程 | Main 编辑当前 workflow.json 快照并调用 apply_workflow；SDK 校验并提交 Agent 与编排配置 | [提案解析](../../sdk/src/internal/workflow-reconfiguration.ts)、[提交与重新调度](../../sdk/src/internal/orchestrator.ts) |
| Evolver 位于 workflow 内部 | main 同时存在于 agents 运行配置和 orchestration.agents 名单中 | [AHE workflow](../../example/01-ahe-evolve/workflow.json) |
| Evolver 修改自身 | Main 的 instructions、model、harness、gatewaySource、skills、autoSkills、mcpServers 与普通 Agent 一样可通过提案修改 | [字段白名单](../../sdk/src/internal/validation.ts)、[Agent 修改测试](../../sdk/tests/sdk.test.ts) |
| Evolver 创建与改写任务 Skill | Main 通过 skillDefinitions 定义完整文件，以 project:名称 分配给自身或其他 Agent；SDK 在项目数据目录保存版本，并刷新使用者会话 | [Skill 存储](../../sdk/src/internal/project-skills.ts)、[新建、执行、改写及恢复测试](../../sdk/tests/sdk.test.ts) |
| Evolver 创建与改写任务 MCP | Main 通过 mcpDefinitions 保存源码和启动配置，再给 Agent 分配 project 引用；SDK 按调用托管服务并随任务恢复 | [MCP 托管](../../sdk/src/internal/project-mcp.ts)、[生命周期测试](../../sdk/tests/project-mcp.test.ts) |
| 修改后继续运行 | SDK 刷新 Main 和配置变化的 Agent 会话，重新调用 Main，随后可回到循环入口执行下一批 | [调度器](../../sdk/src/internal/orchestrator.ts)、[组合测试](../../sdk/tests/workflow-loops.test.ts) |
| 配置与进度持久化 | 保存新 Agent 配置、编排、workspace 路径及循环计数；重启不会自动重跑已完成任务 | [恢复测试](../../sdk/tests/sdk.test.ts)、[循环恢复测试](../../sdk/tests/workflow-loops.test.ts) |

### 当时的实现范围

1. **Evolver 是受授权的 Main。** `allowMainReconfiguration: true` 才开放 apply_workflow；普通 Worker 即使命名为 evolver，也不会获得该能力。第一张图将 Evolver 单独画出是职责划分，当前 SDK 的运行结构对应第二张图。公开 SDK 当前没有供独立外部 Evolver 随时提交工作流热更新的接口。
2. **自修改范围有字段约束。** Main 能修改自己的 Agent 配置及网关来源选择及允许的编排字段，不能移除 Main、改变自己的重配置授权，或通过提案修改权限、会话策略、网关凭据、workspace、SDK 执行器源码。编辑 JSON 后必须调用 apply_workflow，文件修改本身不生效。
3. **可描述多种研究流程，但拓扑须符合 SDK 合同。** 循环组内部是普通 Agent 的唯一强边路径，不支持重叠或嵌套循环组，Main 位于批次出口而非组内。Main 仍属于整个 research workflow，因此与第二张图的包含关系一致。
4. **执行机制和优化效果是两层验证。** SDK 确定性地处理调度、计数、权限、版本校验、提交及恢复；方法生成、评分、代码快照和任务代码接受/恢复由 Agent 按指令完成。apply_workflow 校验配置合法性，不自动对新旧 workflow 做效果对比，也不保证修改后表现更好。提交失败的回滚不等于性能退化后的自动回退。

### 当时的组合验证

新增测试直接读取真实的 AHE workflow，在调用方指定的 workspace 中运行 SDK 调度器，使用模拟 Agent 返回确定性的动作：

1. 执行基线，然后完成第一批 3 轮循环。
2. Main 同时修改自身 prompt、optimizer prompt，并将每批次数改为 2，提交 apply_workflow。
3. SDK 重新调用 Main；测试确认新 prompt 已进入 inbox，旧 Main 会话未复用，提交本身没有重置计数。
4. Main 返回 optimizer，第二批按新 prompt 与新次数执行 2 轮。
5. 按原终止配置完成任务，累计 2 批、5 轮；重新打开 SDK 后核对新配置、workspace 和累计次数均保留。

完整套件 **172 项测试通过**，包含上述组合场景以及关闭授权、Worker 越权拒绝、失败回滚、循环恢复等原有覆盖。本次未调用真实模型；这些证据验证图中机制能够运行，不证明研究方法或工作流已经获得实际性能提升。
