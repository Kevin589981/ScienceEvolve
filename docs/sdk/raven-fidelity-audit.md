# Raven 完整流程核对与实现 TODO

核对日期：2026-09-27。上游：[EverMind-AI/Raven](https://github.com/EverMind-AI/Raven)，固定提交 [`25c576859a70e356befd02af646f5293fb14233b`](https://github.com/EverMind-AI/Raven/tree/25c576859a70e356befd02af646f5293fb14233b)。ScienceEvolve 对照代码基于 `e09e7da7f3f30985fb7b939607b1cebae4b4bfad`。

**当前结论：不提供 `example/raven/workflow.json`。** 默认 Host 的完整协作流程需要动态 DAG、并发执行期间的节点裁决与重规划；当前 workflow 的单下一跳调度不能完整承载。以下区分已确认的调度缺口与尚未实现的适配，不能把列出角色、JSON 校验通过或黑盒启动原 Raven 当作完成复现。这里没有改 SDK 调度器，也没有运行真实模型任务。

## 范围与 Task 边界

仓库包含三套不同流程，不能混成一个固定的“Host → Research → Code → Design → Evolver”链：

| 流程 | 上游边界 | 本次结论 |
| --- | --- | --- |
| 默认 Host 协作 | Host 根据请求自行工作、单次委派或生成 DAG；选择 roster 中的 specialist，处理节点失败，整合终端产物，必要时继续下一图。 | 本次默认复现目标；存在下述已确认的编排缺口。 |
| 独立离线 Evolver | 对作为 Task 的 harness 做基准评估与代码进化，不是每次 Host 协作里的一个节点。 | 完整适配尚未编写；不能由 Host 的并发缺口推断它也必须新增底层。 |
| 实验性 Curator | 通过试炼、反馈分析和验证安装，修改作为 Task 的 Raven Worker 的四个策略面。 | 完整适配尚未编写；若 Worker 保持原 Raven 运行时，不能把其内部 hooks 的缺失误算为 SCIENCEEVOLVE 的必要缺口。 |

来源：[仓库说明](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/README.md)、[Evolver](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/evolver/README.md)、[Curator 与迭代](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/experimental/README.md)。

Host 不是必须调用每一个 specialist。现有 roster 包括 Research、Code、Design、Oncall，以及隐藏在 Design 路由后的 PPT 实现。不能把 Research/Code/Design/Oncall 强制串行全跑一遍。单个 specialist 的原生工具执行可以作为 Task 工具承载；Host 的规划、委派、裁决和循环必须由待复现流程承担，不能整套外包。

## 默认 Host 的能力对应

| 上游能力与实际行为 | SCIENCEEVOLVE 当前能力或缺口 | 完成适配所需交付 |
| --- | --- | --- |
| 先判断自行工具调用、单次委派或多步 DAG；独立性、结果交接或专业分工任一成立时采用 DAG。 | Main 可以规划、路由；策略和动态节点合同尚未移植。 | 原 Host 编排 Skill、roster 能力与任务边界、各分支的行为验证。 |
| 动态 DAG 校验：无环、会话级 node ID、依赖及跨图已完成节点引用、输入模板和路径边界。 | 文件能保存图与产物；workflow 的角色路由不是 DAG 依赖合同。 | 复用或逐项移植 `dag_graph`、模板解析、输入校验与持久 node registry。 |
| 已满足依赖的不同 instance 并发；相同 instance 顺序执行；跨 DAG 与单次委派共享并发限额。 | **当前项目执行循环只 await 一个 invocation；同项目不能同时持有两个 worker lease。** 多项目容量不是单项目 DAG 并发。 | 动态 ready-set、instance 排他、共享额度、节点级状态与产物提交。 |
| 默认后台启动，完成时通知 Host；也支持 foreground，但 foreground 仍运行同一个并发 DAG。 | 当前返回 Main 需要当前 Agent 结束；没有原生后台节点的事件与控制回路。 | Host 可处理通知时其他节点仍存活；事件关联、失败交付和取消生命周期。不能把 foreground 当串行模式。 |
| 每个节点做任务完成判定；未完成的输出不得供后继消费。 | 可增加独立判定角色与文件协议，尚未实现。 | 原判定输入、输出可见性、异常分支及预算。默认最多 2 次 continuation，共 3 次尝试；保留 judge 的不同异常语义。 |
| 某分支失败时报告并等待 Host 裁决，其他分支继续；支持 continue、abandon、replan。 | **缺运行中节点控制协议。** 项目级 pause/resume 不是节点级挂起/续跑；串行走回 Main 会改变其他分支的执行行为。 | 节点裁决 mailbox、无关分支存活、续跑上下文、超时及失败级联。 |
| replan 终止旧图尚未完成工作，保留已完成节点的证据与引用，创建可追踪的后继图。 | `apply_workflow` 可以在边界更新角色与路由，但不提供正在执行的图替换、节点取消和后继图关联。 | 图代际/后继关系、在途节点回收、已提交产物复用、旧节点不能在新图写入过期结果。 |
| 明确 instance 会话延续；不同节点可变更 Skills/MCP；可消费上游输出与记忆记录。 | 固定角色的 sessionPersistence、Skills/MCP 可用；动态 instance 身份及逐节点能力注入尚未适配。 | instance registry、后端支持/降级告知、记忆读写和输出引用的完整工具合同。外部记忆服务无需在 workflow 重建。 |
| 迭代是一轮一个 DAG；playbook 的 stint 可持久运行多轮、自动推进、判断停止并最终汇总。 | Main/文件能表达轮次；其每轮 DAG 仍依赖上述缺口。 | playbook 编译、stint 日志、恢复/停止/预算与检查合同；不能只加固定 maxIterations。 |
| specialist 的领域工具和产品路由：检索、代码执行、图像/文档渲染、长期实验等。 | 工具/后端可外部提供，不是必须内建的共享服务。 | 固定完整 specialist 版本或验证能力等价替换，保留 Design→PPT 条件路由和不可用能力反馈；不能只复制身份提示词。 |

主要上游证据（全部固定于上述提交）：

- [Host 编排 Skill](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/memory_engine/skills/subagent-dag-orchestration/SKILL.md)：触发条件、后台/前台、节点失败与跨轮 instance。
- [DAG schema 与校验](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/agent/subagent/dag_graph.py)：`DagNodeSpec`、`SubAgentDagSpec`、`validate_and_order`。
- [DAG 工具](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/agent/subagent/dag_tool.py)：后台生命周期、foreground outbox、共享预算、能力和状态注入。
- [DAG scheduler](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/agent/subagent/dag_runner.py)：`run_dag`、`_run_ready_groups`、`_apply_verdict`、`_await_adjudications`、`_apply_replan`；continuation 不取消其他存活节点，replan 则中断并替换。
- [裁决状态](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/agent/subagent/dag_adjudication.py)、[控制工具](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/agent/subagent/dag_control_tools.py)、[判定器](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/agent/subagent/dag_verdict.py)：正常失败、判定不可用与调用签名错误不能合并成一种处理。
- [配置默认值](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/config/raven.py)：`SubagentDagConfig` 默认开启 verdict，判定超时 180 秒，证据尾部 8000 字符，裁决等待 600 秒，最多 2 次 continuation。foreground 绑定期间的等待规则由 outbox/runner 决定，不能把 600 秒一律套用。
- [重启后状态对账](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/agent/subagent/dag_resume.py)：无存活 run 的未终结节点显示 interrupted；不能宣称上游会自动恢复所有进程中的协程/mailbox。
- [stint](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/raven/playbook/stint.py) 与 [specialist 产品合同](https://github.com/EverMind-AI/Raven/blob/25c576859a70e356befd02af646f5293fb14233b/agents/README.md)。

## 计划功能后的互斥分类

| 配置条件 | 是否足以完成默认 Host | 仍缺什么 |
| --- | --- | --- |
| 当前 workflow | 否。 | 动态并发 DAG、运行中节点裁决/通知、重规划生命周期，以及上述尚未完成的能力适配。 |
| 加 Agent 回退 + workspace Git | 否。 | 提供恢复基础，不产生依赖调度、后台节点或 Host 控制回路；Git 不撤销已经发生的外部工具副作用。 |
| 再加“独立上下文 + 回合汇总”的并行讨论组 | 仍不足。 | 固定成员的回合屏障不等于按依赖就绪推进，也不保证某节点等待裁决时其他节点继续，更不包含图替换与实例复用。 |
| 讨论组功能若扩展为完整动态 DAG 执行及控制接口 | 可以消除这里已确认的调度障碍；尚不能直接宣称完成。 | 仍须完成并验收 Host、判定/恢复、playbook、记忆和 specialist 的全部适配。以实际接口为准，不能预先假定计划功能已经包含这些能力。 |

因此 Raven Host 归入 **“三项计划功能之外仍需编排能力 + 方法适配”**，不归入“仅缺并行讨论组”。这不是说任意 JS/Python 程序无法实现；通过工具自建第二套并发执行器可能实现，但那已经新增运行时，不是现有 `workflow.json` 的能力。调用整套 Raven Host 再包一层 workflow 也不算在 SCIENCEEVOLVE 内复现。

离线 Evolver 的诊断、候选设计、preflight、应用、screen/confirm、gate、promotion、终止与 sealed-test finalization 需要另作完整映射。源码 `evolver/orchestrator/loop.py` 提供可分解步骤；Task 可保持 Raven harness + 实际评测后端，Git 快照可以用工具承载。Curator 也可将原 Raven Worker 作为 Task，分解 understand/select/design/implement/repair、验证/安装、Trial、Analyst 与多轮反馈。因此目前仅标记两者“完整适配尚未完成”，不从 Host 的缺口推断两者架构上不可能。

## 本次验证及迁入 example 的门槛

检查了当前 [runLoop](../../sdk/src/internal/orchestrator.ts)、[AgentScheduler](../../sdk/src/internal/agent-scheduler.ts)、[控制工具](../../sdk/src/internal/orchestration-control-mcp.ts) 与 [workflow 合同](../../sdk/skills/scienceevolve-sdk/references/workflow.md)：执行循环选择单个 queuedAgent 后 await invokeAgent，路由目标为单个 target。

另对本地构建的 `AgentScheduler` 做了无模型、无文件写入的内存探针：容量设为 10，第一个项目持有 worker lease 时同项目第二次 acquire 被拒绝，而另一项目可 acquire。探针通过，确认不能把跨项目并发容量解释成单项目多节点并发。该探针仅证实当前限制，不是 Raven 复现测试。

迁入 example 前至少验证：

1. 有独立 A/B 和依赖 A 的 C；A 完成后 C 可按依赖调度，无需人为把整个方法变成固定角色链；同 instance 的访问保持顺序。
2. A 未完成进入裁决时 B 持续运行；continue 复用 A 上下文且不重复 B；abandon 正确阻断后继。
3. replan 回收旧图在途节点、保留已完成结果，并准确关联后继图；取消、超时、重复/过期控制输入均有明确处理。
4. 保留判定默认值、失败输出隐藏、continuation 上限及报告交付失败语义；覆盖 foreground 和 background。
5. 校验跨图引用、技能/MCP 收窄、instance 隔离、长期记忆消费、stint 多轮及停止/中断状态。
6. 实际 specialist 能力和工具合同通过检查；workflow 加载、Skill staging 和有证据的端到端运行分开报告。

在以上能力未完整实现前，本条与 example 互斥；后续完成后应移除 README TODO，再提供 workflow、需求文件、Skills、固定来源及对应测试。
