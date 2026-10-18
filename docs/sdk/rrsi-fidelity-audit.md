# Google RRSI：算法复现与原实验边界

核对日期：2026-09-28。论文 [RRSI: Regularized Recursive Self-Improvement of Agent Harnesses](https://arxiv.org/abs/2609.24972)，官方代码固定于 [`be50316e1db05914068a973f322770ef08ed7ba1`](https://github.com/google-research/rrsi/tree/be50316e1db05914068a973f322770ef08ed7ba1)。本仓库交付 [RRSI workflow](../../example/rrsi/workflow.json) 的完整算法和必要能力，通过真实 Task 工具合同承载任务/评测；不声称恢复作者三域八基准的全部实验配置。

这沿用“能力可替换、能力不可缺失”的口径。Task 更换、模型替换、串行承载独立调用及参数变更必须明确记录，不能把这些变化隐藏在“完全复现论文数值”之下。默认需求采用真实科研 Task；原始 benchmark 数据和工具不是假数据替代品，缺失时应阻塞实际科研运行。

## 逐项来源映射

以下源码均为上述固定commit下文件；完整副本和哈希随 Skill 分发，未更改上游归档。

| 必需方法能力 | 官方源码 | SCIENCEEVOLVE 实现与核对 |
|---|---|---|
| 三镜头、跨轮稳定命名、analyst不读raw trace | `rrsi/analyst.py` | 直接重放原 `analyze` 协议；每次模型调用转为 analyst ticket，digest_many转独立digester票据，整批返回后才继续分析 |
| 独立failure/capability_gap/success诊断、只读工具、追问与输出上限 | `rrsi/digester.py` | 原 `digest_task`；每次调用有独立scope，即使重复同task/lens也不错误合并；15轮和原工具上限保留 |
| 正则化提案、原子编辑元数据、真实文件修改、abort/max-turn分支 | `rrsi/propose.py` | 原 `propose`；40轮/80文件动作；完整constitution/patterns/report/history/scoreboard；每次repair保存起始源码快照，恢复不重复应用修改 |
| 泄漏precheck、LLM审查、格式失败、最多5次修复 | `rrsi/critic.py`, `rrsi/loop.py:_draft` | 原 `review`；控制器显式管理review/repair/gate/commit/smoke；不调用 `_draft` 或上游自治loop |
| 余弦退火、停滞探索、组件试验/剪枝、差分重标 | `schedule.py`, `history.py`, `components.py` | 原函数；未测失败不计tried；保留槽需实际diff证据；accepted组件计数保持官方累计语义 |
| 独立候选工作树、固定Task与真实测量 | `gitops.py`, `evaluate.py`, `loop.py:_evaluate` | 独立Task Git、同incumbent fork、固定完整evolve×k；真实Task subprocess工具，官方缺失重试与gate_failure保留 |
| 历史最佳floor、成本/噪声分支、结构novelty、独立guards、argmax/保留 | `selection.py` | 直接调用 `select_round`，保留严格/非严格比较和候选顺序平分处理；selector Agent只运行/检查计算，不主观改规则 |
| 逐编辑history与事后归因、T轮与恢复 | `history.py`, `loop.py:attribute` | 原记录/归因算法；选择transaction幂等写回；STOP轮间暂停；完整T轮后冻结冠军 |
| 未参与选择的数据上H0/冠军同条件评测 | `Domain.heldout_ids`, `Run.heldout`及各域评测协议 | heldout Agent按预登记surface逐臂运行相同原子Task工具；缺失保留分母；无回到提案/选择的状态边；核对证据后export |

对应执行器位于 `example/rrsi/skills/scienceevolve-rrsi/scripts/`：`protocol.py`拥有研究状态机，`roles.py`只负责原始模型协议重放，`task_domain.py`负责真实Task原子操作，`heldout.py`负责冻结双臂测量。模型票据保存完整system/cache_prefix/prompt，不能让Main只传摘要。

## 承载替换与参数

研究角色使用 workflow 的 gpt-6-sol / Codex profile，替换原Claude调用；Task policy另行冻结。upstream search-model client不会被调用，不能黑盒运行 `rrsi.py run`、`driver.drive`、`Run.round`。工具反馈、动作解析和原提示词仍由官方协议提供。

官方digester线程池默认6并发、一次最多8项请求。本模板串行执行独立调用并保持原顺序/batch barrier；输出全部返回后analyst才能继续，候选之间也不共享未授权上下文。该替换改变吞吐，不删减调用或汇总。三套官方config的候选eval_parallel均为1。

原profile全部保留在归档。默认eng为40轮/4 trials/2候选；coding和workspace为20轮/2 trials/2候选。Task变更后的统计量和成本预算须重新说明；控制器支持configure前显式参数覆盖及官方delta=null校准分支。默认需求为新Task使用基线bootstrap，报告同时保留原profile、覆盖值与替换说明，不能称新配置是论文原实验。

本模板要求真实完成trial提供正数policy token计量，避免官方 `relative_cost_change` 在成本缺失时回退为0，导致未经测量的成本看似未增加。未完成trial仍按原缺失规则处理。领域guards通过冻结Task合同逐项实现，不能因为总分上升而抵消可行率/交付率的退步。

## 论文原实验：已核实的外部协议差异

这里记录的是原实验复刻边界，**不是把RRSI算法另列成未完成方法，也不是声称SDK缺底层能力**。当前模板保留的是完整RRSI方法与真实Task能力；要求原实验逐项一致时，下面内容不能直接用公开脚本冒充已完成。

1. **Workspace OOD包装没有包含论文的完整judge管线。** [`run_gdpval.sh`](https://github.com/google-research/rrsi/blob/be50316e1db05914068a973f322770ef08ed7ba1/domains/workspace/ood/run_gdpval.sh#L15-L34) 只导出harness并执行用户给的GDPVAL_RUN_CMD，JobBench/APEX同类。论文附录A.4要求JobBench加权rubric及两模型平均；A.5要求GDPval三种来源judge、两个呈现顺序、多数表决；不能用一个通用pass@1脚本替代这些能力。使用这些原benchmark时，Task适配必须提供相应真实执行/判分能力；服务可以外置。
2. **GDPval原文数量矛盾。** 附录A.5同时写185任务、每pair两个顺序、每judge每harness共204次比较；185×2并非204。论文原切分与完整逐judge结果未包含在上述公开仓库。不能自行把185或102当成“已核实原切分”；普通研究Task可冻结自己的完整清单并声明差异。
3. **Frontier脚本的诊断指标不是论文Medal。** [`final_eval.sh:109–125`](https://github.com/google-research/rrsi/blob/be50316e1db05914068a973f322770ef08ed7ba1/domains/eng/scripts/final_eval.sh#L109-L125) 统计可评分pair的win/tie/loss并跳过无评分pair；论文A.8使用固定v1阈值、47任务分母、未评分计零。官方[Medal资产](https://github.com/EinsiaLab/Frontier-Engineering/tree/bafa7d53162a3b1f128fec396bbde22fe972bf24/leaderboard)可取得，但还需冻结版本、任务映射和不可评分项处理，不能把win rate改个名字。
4. **Frontier缺提交时有误用初始程序的风险。** [`verify_frontier.py`](https://github.com/google-research/rrsi/blob/be50316e1db05914068a973f322770ef08ed7ba1/domains/eng/bench/verify_frontier.py) 的job分支遇到缺payload会传None，`grade_one`则保留benchmark自带初始程序；原意是支持baseline replay，但不能据此给候选缺提交计入初始程序成绩。原benchmark工具适配应显式区分这两种用途。
5. **公开EngDesign v1工具引用的补丁资产缺失。** [`build_testsurfaces.sh`](https://github.com/google-research/rrsi/blob/be50316e1db05914068a973f322770ef08ed7ba1/domains/eng/scripts/build_testsurfaces.sh#L27-L50) 读取九项`data/engdesign_v1/...`；固定commit树中没有该目录，检查时仓库也没有release/tag提供这些文件。它是官方代码额外的反reward-hacking诊断surface，论文A.7/A.8没有给出这九项补丁的完整定义，不能捏造修复内容。不是普通云服务没部署，也不是workspace Git能生成的资产。

## 底层能力分类

| 问题 | 当前SDK / Task工具 | 回退+workspace Git | 再加并行讨论组 |
|---|---|---|---|
| RRSI完整算法 | 固定角色、文件状态、Task Git worktree和实际执行工具可承载，本例已实现 | 改善恢复体验；不是首次解锁算法的前提 | 改善独立digest吞吐；不是省掉原角色/汇总的理由 |
| 作者原实验资产和上述指标/口径 | 需具体Task工具适配和来源核实；不判作SDK架构不支持 | 不补论文缺失资产或修复统计口径 | 不补缺失judge配置/原始任务清单 |
| 实际隔离/外部作业幂等 | 由冻结Task runner、容器/实验服务与job ID提供；文件协议不是安全沙箱 | 本地Git不能撤销已完成物理实验或重新抽样 | 不自动提供资源/评测隔离 |

## 验证边界

离线测试覆盖官方算法边界、原角色动作重放、独立digester与汇合、确定性泄漏拦截、五次修复、候选同源隔离、真实Git/子进程调用、全轮次与heldout终点、恢复不重复测量、成本/缺失分母和配置篡改。另做SDK真实加载/Skill暂存，以及随附官方核心算法测试。

测试中的模型回复和分数是明确标记的synthetic fixture；没有调用真实研究模型、运行三域完整benchmark或得到新的科研结果。因此这些测试证明实现契约，不能证明模型能力等价、运行环境已经部署或论文数值复现。
