# Science 方法的完整 workflow 核对

适用范围说明（2026-10-06）：下文内部路径、单活动 Agent 等编排分析来自旧 legacy 内核。当前默认 main 已提供 Git/scoped 并行组；这不会自动补齐具名科研方法的算法与工具映射。已有 workflow 已迁移，但离线合同或旧测试不等于新引擎真实科研验收。当前接口与验证见 [main 手册](../../sdk/docs/main-cli-zh.md) 和 [本轮报告](../../sdk/docs/workspace-main-acceptance-20261006-zh.md)。

只接受完整的上游流程：阶段、默认参数与可选分支、信息可见性、工具、候选选择、评审、实验、失败处理、恢复、终止和产物必须全部有执行位置。允许等价能力替换，例如 SCIENCEEVOLVE 角色替换原 LLM 调用；不允许普通聊天替换实际检索/代码执行，也不允许删减候选数后仍用原方法名称。不能启动另一整套自治系统，再把外面的一层节点叫作 workflow 复现。

完整流程配置与真实科研运行验收分开。下面十项交付完整配置、执行规范与工具映射，已做离线检查；**没有真实模型/GPU/远程实验服务的端到端运行记录**。无法完成的其他方法只列在 [README TODO](../../README_zh-CN.md#补充方法流程)，不再提供部分示例；AI Scientist 只保留 v2 作为目标。

## Task 与底层边界

Task 是研究对象及真实反馈环境，例如待测 harness、训练程序、数学函数、图谱、实验数据。research workflow 决定提案、调用、分析、验证；Task 内部的 Agent 不自动成为研究角色。十项都是单层闭环，关闭 `allowMainReconfiguration`，没有额外 Evolver。

现有 [schema](../../sdk/src/internal/validation.ts) 和 [orchestrator](../../sdk/src/internal/orchestrator.ts) 支持顺序角色、路由、循环与用户交接；每个角色可选独立模型/Harness。[client](../../sdk/src/client.ts) 支持 start/pause/resume/respond；[storage](../../sdk/src/internal/storage.ts) 的调用提交恢复不撤销任意 Task 文件或外部作业。

项目内只有一个活动 workflow Agent。**这不妨碍 Agent 调用 Task 工具启动多个实验进程或远程作业**。ARIS pilot/queue、Robin 五轨迹分析不能因此被删成串行单实验，也不能被误列为“等并行讨论组后才可做”。候选目录/原 Git 操作不等同 Agent 历史状态回退；新会话读取指定材料不等同操作系统级盲评隔离。

## 完整能力映射

各例 Skill 提供执行协议，以下列出审核重点。固定来源 commit 与逐文件 SHA-256 在例内 SOURCES/UPSTREAM 中；归档源文件是运行时必须执行的规范，不是历史附件。SCIENCEEVOLVE 负责角色与阶段调度，原子算法/工具可以直接复用。

| 方法 | 原流程能力 → 实现位置 | 等价替换与环境前提 |
| --- | --- | --- |
| [ARIS](../../example/aris/workflow.json) | W1 文献/lens/跨模型筛选/novelty/pilot/refine/合同 → literature/ideas/novelty/refine；W1.5 实现、代码审查、sanity、run/queue、监测、消融与结果 → bridge；W2 最多4轮与原 score/verdict 联合门槛 → research_loop + reviewer；叙事、W3 plan/接受合同/图/稿/编译/2轮改稿/全部适用审计 → 对应 paper_*、figures、paper_reviewer。 | 主线全部 Skills/tools/templates 随附；跨家族 reviewer 通过真实角色交接与完整 transcript 续接；`review_bridge.py` 校验材料哈希、配置家族并调用原 review_gate。普通评审按逻辑thread完整重放，避免跨阶段串上下文；深审用原ultra与合法fallback。另随附Anti-Autoresearch固定pin的65文件/许可，逐维度通过readonly_review.py调用实际只读独立审计，再由原代码裁决。普通角色材料白名单不声称是文件系统隔离。 |
| [Meta-Harness](../../example/metaharness/workflow.json) | 官方完整 text_classification reference：基线；默认20轮、每轮3候选、强制原型、自评/import检查；全数据集/种子训练验证；逐数据集best + Pareto；显式冻结baseline/Pareto/单数据集winner并集的test finalize；失败保持in_progress → main/propose/evaluate/analyze + 原 benchmark/纯函数。 | 替换外层 proposer；Task 内 MemorySystem/被测Agent不拆成workflow角色。用户提供完整Task checkout、数据与模型。未将“只优化一个候选平均分”称为完整Meta-Harness。 |
| [autoresearch](../../example/autoresearch/workflow.json) | 专用分支/只读评测哈希/基线；每轮train.py commit、300秒真实训练、10分钟超时、简单crash修复、复杂度权衡、五列TSV、真实Git keep/discard；默认无限运行 → main/propose/train/select。 | `finish_trial.py` 真正记录与恢复Git，拒绝用户未提交更改/非train.py变更/重写决策。Task Git由现有工具提供，不冒充Agent状态回退。程序协议独立撰写，未擅自vendor无许可证文件。 |
| [FunSearch](../../example/funsearch/workflow.json) | 官方完整 serial pipeline：10岛、4样本、原prompt版本化/聚类/温度/短程序偏好、原Evaluator解析/祖先引用判断/逐测试成绩登记、4小时弱半岛reset → main/sample/evaluate + runtime.py。 | 原数据库/评测代码直接复用；保存完整RNG/数据库与幂等样本记录。模型替换抽象LLM；真实隔离Sandbox是上游明确需提供的接口。保留官方串行算法，不把分布式吞吐作为此公开实现已有能力。 |
| [Agent Laboratory](../../example/agent-laboratory/workflow.json) | 完整单实验室7子阶段、原角色与命令；MLESolver初始化+2次solve、每solve至少2次尝试/有效分、执行/repair/reward/reflection；PaperSolver分节初始化+5次solve、每次至少3次尝试/有效分、arXiv/编辑/编译/原加权reward；3 persona审稿、人工反馈/回planning、prev_*与局部history → main及15角色。 | 替换query_model和会话承载；原阶段prompt、工具、求解器源码随附。paper_score.py直接执行原评分函数。官方默认agentRxiv=false是完整单实验室方案；跨实验室AgentRxiv作为不同完整扩展列在下表。 |
| [SciAgents](../../example/sciagents/workflow.json) | fixed：真实图/embedding路径、ontology、七字段及逐项扩展、科学批评、分子建模/合成生物学方案、报告/PDF；automated：原角色prompt、动态speaker/共享transcript/50发言、独立新颖性与可行性评估（实际top10摘要、最多3次查询/10turn） → main和原角色映射。 | 两种官方模式均保留。Main替换原顺序AG2 manager；图/embedding/GraphReasoning/Semantic Scholar/PDF为真实Task能力，不能改为无图泛化讨论。原notebook与工具随附。 |
| [Robin](../../example/robin/workflow.json) | assay查询/检索/提案/详细调查/两两比较+ILS排名/目标；候选查询/检索/提案/FALCON调查/排名；外部实验交接；5条并行R分析→共识→四字段解释→followup→注入下轮候选 → 15 workflow角色。 | 普通LLM调用可替换；实际CROW/FALCON/data-analysis服务不能省。analysis_step.py每次仅派发当前原子阶段，验证5份文件/任务ID后允许共识；原物理实验由外部人类执行并真实回传。 |
| [Google AI co-scientist](../../example/co-scientist/workflow.json) | 目标/资源分配；4种生成；6类反思；相似图/cluster；新/近邻/top优先配对；高排名多轮论辩与Elo；6种进化新候选；元反馈、概览、专家/真实实验回环 → main/generation/reflection/proximity/ranking/evolution/meta_review/wetlab。 | 用户明确允许同步替代异步，文件池替代持久服务。pool.py落实不可变候选、完整评审门槛、原子文件状态、幂等比赛、目标epoch和Elo。论文初始1200；其余未公布工程参数明确作为本地选择，不冒称Google内部数值。 |
| [Biomni A1/E1](../../example/biomni/workflow.json) | 原资源检索/索引解析/know-how全文；原ReAct生成/标签；真实持久Python、R/Bash/CLI、错误/超时/绘图观察；可选自批评和原500步预算；报告 → retrieval/researcher/execute/critic/main。 | 随附22个工具领域模块、描述、know-how、数据下载器与E1安装资源。bridge抽取并逐次执行固定A1原子函数，由SCIENCEEVOLVE给真实模型回复，不调用上游自治graph。wetlab角色可接实际外部平台，模拟不算实测。完整E1/数据需要部署；未声称本次已安装全部环境。 |
| [AgentRxiv](../../example/agentrxiv/workflow.json) | 全部原Lab科研阶段/求解器/评审，加top5archive语义检索、PDF全文/5句摘要及综合、终稿发布/回读、多篇与跨lab复用 → 原Lab角色+archive+main。 | 共享服务是外部工具；随附原服务代码可另部署。每lab独立SCIENCEEVOLVE项目/workspace/data-dir，共用archive；真实IO脚本缓存PDF/全文/哈希并验证发布回执。保留原完整科研循环，修正原入口未启用archive与完成后无条件抛错的问题。 |


固定上游版本：ARIS `341f914024d270dc5c8fa51337d1ad38829273aa`；Meta-Harness `0cbc31e97c9e6d24232d1dc754827c02e1ec415c`；autoresearch `228791fb499afffb54b46200aca536f79142f117`；FunSearch `cc53f274237d7ab05c19df939edbc1f9616a7c19`；Agent Laboratory `d9017d90e329112d2a80b7712f37ee9094d2cd27`；SciAgents `c5c30451b29cba813a11b5ce078909a214dad9f2`；Robin `4a5cce310f3bc7663a67117db88af43b84733ffe`。

两个源实现错误按方法原意修复并记录：Agent Laboratory 人工分支读取实际回答；Robin 反馈轮排名读取当前 `_experimental` 报告而非首轮旧报告。原始归档源码不修改，SCIENCEEVOLVE执行协议显式规定修复位置。

## ScientistTwo 专项核对

2026-09-27 已按用户指定首轮3候选实现 [ScientistTwo完整流程](../../example/scientist-two/workflow.json)，并从README TODO移出。种子池默认6，全部主阶段、PaperOrchestra/ScholarPeer内部角色、完整性审计和失败/保留旧最佳分支由持久控制器与SCIENCEEVOLVE角色执行。逐项对应、参数来源、未公开配置的显式解释和验证边界见 [ScientistTwo复现核对](scientist-two-fidelity-audit.md)。当前SDK即可承载；这不等于恢复作者未公开的原始配置或已经复现论文数值结果。

## RRSI 专项核对

[完整RRSI算法workflow](../../example/rrsi/workflow.json)保留官方提案/选择两侧全部机制、原角色协议、确定性数学门槛和冻结后的成对评测，以真实Task工具合同允许等能力替换。科研编排不自修改，无Evolver。原三域实验的外部judge包装、指标差异和未发布资产单独记录在[核对文档](rrsi-fidelity-audit.md)，不冒称原实验已复现，也不把这些问题归成SDK缺底层能力。

## 未加入 example 的分类

完整互斥清单与每项的具体缺口只维护在 [README TODO](../../README_zh-CN.md#补充方法流程)。分类依据：

| 分类 | 核对结论 |
| --- | --- |
| 只需 Agent 回退 + workspace Git | 暂无已确认完整方法。不能把原已可用Task Git做的keep/discard错算成新解锁。R/G需要绑定同一逻辑checkpoint，恢复会话/调度/受管文件，外部作业另处理。 |
| 只需并行讨论组 | 暂无已确认完整方法。P须有共同输入快照、独立成员上下文、输出位置、join/quorum、失败/超时、唯一聚合者；可补并行讨论，但不能代替整个异步科学系统。 |
| 只需R+G+P组合 | 暂无已确认完整方法。Git不自动提供worktree，回退不自动提供fork，讨论组不自动提供GPU作业隔离。 |
| 仍缺算法适配/底层/领域能力 | README分别标明：v2完整BFTS适配；Kosmos知识利用协议；InternAgent研究/优化协议；Biomni-R0训练/部署闭环；化学Coscientist完整研究/工具映射；AlphaEvolve完整算法/评测反馈。外部服务可接入，不把尚未写全模板误判为SDK底层绝对不支持。 |

外部共享服务属于运行提供者，不是科研流程的内部节点。文件可以承载有完整读写/排名语义的持久假设池；对Google co-scientist同步调度已明确允许。硬件可由湿实验Agent通过真实工具调用，不再作为“workflow不可实现”的通用理由。

这是对尚未完成适配的必要能力判断，不是声称这些方法在SCIENCEEVOLVE上永远无法实现。已有Task执行器、知识服务、领域接口可接入；补齐后验证整个方法，再整体从TODO移入example，不能同时保留“部分可表达”和“无法实现”。

## 实际检查与如何重跑

```bash
# 实际本地算法、证据/恢复协议、临时Git仓库；不会调用科研服务
python -m unittest discover -s example/tests -v
# SDK真实配置加载、完整Skill文件暂存、移植路径和TODO互斥
npm test -- --run tests/research-examples.test.ts
# 按模板重复CLI校验；不调用模型
scievolve workflow validate example/aris/workflow.json
```

Python测试需numpy、scipy、absl-py、PyPDF2；新增Biomni原子执行测试还需可导入A1的LangChain/LangGraph核心环境，缺依赖时测试显式skip而不是报告已覆盖。新增检查实际持久REPL、自批评、过期prompt、文件假设池、Elo与幂等、真实本地HTTP/PDF回读。完整E1/数据和远程科研环境另行部署。此前额外运行固定Anti-Autoresearch的9个确定性eval fixture（7个注入缺陷全部检出、clean无误报）。这些均未调用审计LLM。覆盖原FunSearch默认参数/同RNG prompt/四样本/幂等恢复/失败候选/弱半岛重置、原ARIS门槛及过期证据、真实Git回退、原论文评分公式、原Meta-Harness冻结集合与缺测试时拒绝完成、Robin五轨迹聚合门槛、上游文件哈希。SDK测试验证Skill复制后原脚本及资源仍存在。SciAgents真实图工具、ARIS所有科研分支、Lab完整实验、Robin远程数据分析等仍需实际环境端到端验收，离线检查不覆盖它们的科学有效性。

本次新增流程验证：32项Python协议/算法/IO检查全部通过（包含实际导入A1执行，未跳过）；11项SDK配置加载/Skill移植/互斥检查通过；3个新增workflow及其Skill、SDK authoring Skill校验通过，TypeScript类型检查通过。运行这些检查的环境仅用于协议验证，未下载完整数据湖或安装完整E1，更未运行真实科研模型与湿实验。
