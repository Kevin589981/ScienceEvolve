# 新增工作流的原子工具合同

2026-10-14。此接口是本次设计选择，不是上游原有 API。`task-bridge.cjs` 是传输适配器，不能提供训练器、设备、知识图谱或科研算法本身；相应服务尚未实现/接入。所有新 workflow 内嵌该代码及逐角色 `tools.json`，可单独复制 JSON 校验。SDK 提供 MCP 协议库；外部依赖由服务部署方负责。

## 部署与请求

每个方法配置其 `*_BACKEND_URL`、`*_BACKEND_TOKEN` 和全新的 `*_SCOPE_ID` 环境变量。认证可选，但未启用认证时 `*_BACKEND_TOKEN` 仍须显式定义为空值，不能省略该 envFrom 源变量。workflow 的 `envFrom` 映射到桥接器的 `SCIENCEEVOLVE_TASK_BACKEND_URL/TOKEN/SCOPE_ID`。URL 是明确的 HTTPS 或本机 HTTP POST 端点；不保存凭据，不自动重定向。backend 在远端按 token/scope/actor 校验权限，不能把调用方传来的 actor 当身份认证。

请求格式：

```json
{"schemaVersion":1,"method":"internagent-1-5","scopeId":"unique-run-scope","actor":"verification","operation":"get_state","requestId":"unique-read-id","arguments":{}}
```

响应必须回显 schemaVersion、method、scopeId、operation、requestId，并返回 `status: ok|blocked|failed|unknown`、`data` 和 `evidence` 数组。每个证据包含 `id/uri/kind/sha256`，SHA-256 是真实字节摘要。成功写入必须有非空的持久回执。`read_artifact` 返回 `data.text/data.sha256`，桥接器核验实际 UTF-8 字节；其他证据的科学内容仍需审核，不由传输层判定正确。成功提交作业表示已入队，只有后续 `get_job` 的真实终态与测量能证明执行。

## 一致性与恢复

- 状态保存在 backend 的专属 scope，不能放在 SDK 会刷新的 Skill/MCP 执行副本。各 worktree 只导出自己的结果目录。
- 写操作要求稳定 `requestId`；状态变更还要求 `expectedRevision`。backend 在事务中实现幂等、CAS 和追加式事件账本。参数相同的重放返回原回执；同 ID 不同参数拒绝。
- 30 秒传输超时或异常响应后，写操作结果为 unknown。用 `get_request(originalRequestId)` 对账，不换 ID 重复训练、部署或物理作业。查询本身不触发新作业。
- backend 返回类型化的能力清单、原子接口版本、软件/模型/数据/评分器摘要、资源探测和预算。能力缺失返回 blocked，不提供模拟回执。
- 服务只能提供检索、图/记忆存取、数值选择/回传、具体环境步、编译、实验作业、训练作业和权重部署等原子操作。禁止暴露 `run_internagent/run_raven_host/run_coscientist` 等完整自治系统入口。研究规划、候选内容、优化方向和终止裁决由 SDK Agent 作出。

## 各方法的附加合同

### InternAgent 1.5

能力清单至少包括真实文献检索/全文、图+向量检索、FlowGraph CAS、可执行 baseline、实验评分器、图增强 Monte Carlo 的数值选择/回传、SPM/TEM/SKM 以及有效 embedding。任务记忆、在线保存、长期 IdeaGraph/PromptEvolver 与 DR 的 SPM 需区分。`select_search_context` 返回选择参数、visit/value、父/祖先/跨支引用、运算符和租约，Agent 产生候选；`record_evaluation` 根据真实 job 回执回传分数。不得把最新 MLEvolve 整体启动当成这些能力。

FlowGraph 节点含 search/solve/answer 类型、任务、状态、结果 context；边含 requires/provides/constrains 语义、来源与修订。`claim_flow_node` 事务中检查全部依赖、节点未重复执行、分支身份与 epoch。当前 SDK 用两个 worker 在批次边界调度，新增动态节点只能由 Planner 后续批次处理：这保持数据依赖，但不是原方法即时按 ready-set 推进，报告须扣分。

### Biomni-R0

`read_training_recipe` 必须给出已溯源的原方法 recipe 及待核对项、基础权重/环境/任务版本、真实 reward 定义、数据划分、训练/评估参数。无法核对原训练策略时，不能填写自选 GRPO/PPO 或随意 reward 当作原方法。此设计没有固化未经证实的 SFT/RL 阶段；服务按核实 recipe 执行原子训练作业。训练前核验 reward 与 split，held-out 标注不进入训练上下文。

`collect_trajectories` 是固定 policy 与真实 E1 工具环境的任务执行；轨迹保留 observation/action/tool result/terminal outcome/policy hash，不包含自改研究规划。`score_trajectories` 由独立评分器产出奖励。`submit_training` 必须返回 job、输入轨迹/奖励/recipe 摘要；终态返回真实 checkpoint。部署和评估均绑定 checkpoint 字节摘要，明确环境与旧权重回退。使用发布成品 R0 只能作为比较基线，不能替代训练。

### Chemical Coscientist

检索/设备文档工具返回真实 URL、版本、内容摘要及可读取证据；文档必须与实际设备/API 匹配。`compile_protocol` 校验输入代码和设备能力，返回源码摘要、编译结果与设备绑定。`submit_experiment` 需要真实 `authorizationId` 和相同代码/设备摘要；设备服务在提交端核验授权、参数范围与资源，workflow prompt 不代替设备约束。

`get_job` 返回真实物理作业状态、测量/错误/样品链；断线未知作业先对账。优化读取真实结果、噪声/失败和预算后决定下一实验。Git 只管理代码/报告，不能撤销湿实验。simulation/historical-data 是独立标记的模式，不计为湿实验复现。

### Raven Host

新模板只提供 SDK 内可执行的固定双 specialist 批次及边界判定骨架。backend 仅记录图、节点、instance、记忆与原子领域工具，不可承担 Host 规划或另建运行时来声称 SDK 原生支持完整 Raven。严格默认 Host 需求在 preflight 返回 blocked：当前合同缺任意 AND ready-set、在线通知/裁决、在途取消与图替换。

judge 回执区分 incomplete、判定不可用、参数错误；未通过节点输出不能提供给依赖节点。最多两次 continuation 是节点总预算，不因新批次/重启归零。固定两个 SDK 会话仅提供有限 instance 复用；跨任意图实例、逐节点 Skills/MCP、stint 自动推进仍是待实现接口。这个模板不能把所有 specialist 强制串行，也不能把批次重跑写成原语义的在线 continue/replan。

## 运行前应做的验证

先离线校验 JSON 和实际 Skill/MCP 暂存，再对部署后的原子服务验证资源/权限/幂等/CAS/unknown 对账，最后才运行真实方法。JSON 校验、桥接 localhost 合同或接口清单不等于方法/论文验收。每次新运行记录唯一 SDK run ID 与 backend scope，保留负面结果、源字节摘要、累计预算和完整事件链。
