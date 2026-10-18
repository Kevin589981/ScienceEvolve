# ScientistTwo 论文复现核对

核对日期：2026-09-27。目标为 Nam 等人的 [ScientistTwo v1](https://arxiv.org/abs/2609.19644v1)。完整流程配置现位于 [example/scientist-two/workflow.json](../../example/scientist-two/workflow.json)，角色合同、持久控制器、来源及离线验证随例提供。已从 README TODO 移出，二者互斥。

用户已指定首轮候选 **3**，并允许选择种子配置。本例种子池默认 **6**。实现覆盖论文公开的科研流程；对未披露的配置、嵌入版本和有歧义的轮数采用下列显式解释，不宣称恢复了作者私有源码/全部原参数，也未完成真实科研数值结果复现。

## 固定来源

- [ScientistTwo v1 HTML](https://arxiv.org/html/2609.19644v1)、[PDF](https://arxiv.org/pdf/2609.19644v1)：§3.1–3.6、§4.2 的完整性修正、§4.3 的跨次研究、附录 A.2。作者以 CC BY 4.0 发布论文；本记录以章节定位并归纳，不复制整篇论文。
- [作者项目页](https://scientist-two.github.io/)：核对系统介绍、公开论文展示和完整性检查。此页未提供 ScientistTwo 主系统源码链接；当日 GitHub repository search 的 `ScientistTwo` 查询未返回仓库。这是本次检索结果，不是证明任何位置都没有源码。
- [PaperOrchestra 官方仓库](https://github.com/google-research/paper-orchestra/tree/ca1b3fa01c2970fc7cda32d16245db38d57b3f56)：已随执行 Skill 提供必要代码、prompt、工具与 ICLR2025 模板，固定 commit `ca1b3fa01c2970fc7cda32d16245db38d57b3f56`，Apache-2.0。它是写作子系统的公开参考；ScientistTwo 没有说明自己使用的 commit，不能直接宣称这个版本就是原实验依赖。
- [ScholarPeer v2](https://arxiv.org/html/2601.22638v2)：§3、附录 C/D/G 包含内部角色、检索条件、Q&A 和原始 prompt。ScientistTwo 指定 ScholarPeer，但没有固定具体版本或全部嵌入配置。本次不以社区重写仓库代替官方方法。

下载证据 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| ScientistTwo v1 PDF | `98fb7802ec28beea159895a3de219307e019867b16296dfe4a79e68daaef9a17` |
| ScientistTwo v1 HTML | `23f93180ac10e5b4e1cbdf9f1e532aa80c33351b7968345752ec7c6d12925aa3` |
| ScholarPeer v2 HTML | `8df90b732f9eeb9e4115df1218fd94ec147cf8008b74742ef88bc0d9ddb2d129` |

## Task 与 workflow 的边界

Task 是给定科学问题、原方法代码、数据集、评价指标与执行资源。科研角色在受控实验副本中修改 Task 代码并取得真实结果。假设进化不等于进化 SCIENCEEVOLVE 编排：不得因此启用 `allowMainReconfiguration`，也不需要额外的 workflow Evolver。

Main 仅承担 SCIENCEEVOLVE 调度、计数与结果提交。不能用 Main 的自由判断替代论文中的 novelty checker、subset/full critic、selector、result comparison、peer review 或 meta review。各判断必须来自对应角色，保留输入、决策、理由和版本。

## 必須完整映射的流程

| 论文位置 | 必需角色和控制行为 | 输入、输出与验证要求 |
| --- | --- | --- |
| §3.1 limitations | Limitation Extractor → Limitation Verifier；不足则补充，不覆盖此前发现；达到通过条件或轮数上限才退出。 | 问题/原方法 → 可操作限制集合、验证反馈及轮次记录。明确预算用尽时的终止语义。 |
| §3.1 seed pool | Initial Idea Generator → Novelty Checker → Idea Generator，构建 `N_seed` 个有区别的候选并按新颖性降序排列。 | 每个候选关联限制、评分与检索证据；保留已评/未评集合，不只生成一个 idea。 |
| §3.2 baseline | Baseline Coding Agent 真实复现同一 benchmark 子集。 | 冻结子集、可重跑代码、环境、执行日志和多指标结果 `E_base/C_base`。 |
| §3.2 subset | Subset Coding → Subset Critic，输出 Good/Bad/Engineer；Engineer → Subset Engineering → 再评；Bad 或预算耗尽且未 Good 则剪枝。 | 每个候选从基线副本开始；不能把“工程失败”“被剪枝”作为成功。子集必须与基线可比。 |
| §3.2 full | 仅子集 Good 才进入 Full-Set Coding → Full-Set Critic → 可选 Full-Set Engineering 回环。 | 对完整 benchmark、多数据集/指标验证；full critic 比较原 SOTA，不能把子集胜出视为全量成功。 |
| §3.3 evolution | 首轮 top-`N₀` seeds；之后 Idea Evolver 读取全部成功与失败轨迹产生 `N_k` 个新候选，同时补入 `N_e` 个未评高新颖性种子。 | 所有候选完整经过 §3.2；历史失败日志不能丢。达到 `S` 个 Good 或轮数界限后退出；最终零成功时整个流程终止。 |
| §3.3 selection | Selector 在全部 full-set Good 候选间选择最佳。 | 保留多指标与日志判断，输出同一版本的 `h_best/E_best/C_best`。不能自行改成单一加权标量最大化。 |
| §3.4 ablation | Ablation Planner → 对每项计划执行 Ablation Coding → Ablation Critic；Refine → Full-Set Engineering → Result Comparison。 | 覆盖全部计划，保留原最佳副本；只有严格更优才替换最佳，替换后重做消融。负改进不能污染最佳代码。 |
| §3.5 draft | Initial Drafter 内含 PaperOrchestra。 | 输入 idea、完整结果及消融；输出符合 ICLR 2025 格式的 LaTeX/PDF。其内部文献、图表、章节写作、反思和编译不能省略。 |
| §3.5 review | Peer-Reviewer 使用 ScholarPeer；低于 8 时 Rebuttal Planner → 每项 Rebuttal Coding → Paper Enhancer → 重新评审。 | 必须真实执行补实验；不能仅写一封 rebuttal。保存每版稿件、完整 review、补实验计划/结果、score 和预算。 |
| §3.6 meta | Meta-Review 的 Accept 导出结果；Refine → Full-Set Engineering → Result Comparison。 | 更优则替换最佳并重跑消融、draft、peer-review；不更优则丢弃修改，导出上一最佳稿件/代码并终止，不能伪造 Accept。 |
| §4.2 integrity | 实验后 specification filter；检索增强 reference verification → Writer 修正；method–code audit → Writer 修正。 | 排除 reward hacking，核对引用真实性及代码/文字一致性；Coder 始终给出可独立重跑的脚本。四类 CoE 验证不能退化为自报 PASS。 |
| §4.3 frontier expansion | 将本次导出的论文与代码作为下一次研究的问题背景/新基线。 | 明确是多个研究运行的串接，不是自行修改 workflow；不把该案例的三次迭代强加为每个 Task 的必需次数。 |

原方法的失败、被剪枝、零成功退出、预算用尽和“保留旧最佳终止”都是正常控制分支；SCIENCEEVOLVE 的任务完成记录必须另带科研结果判定，不能把调度结束都标为论文被接受。

## 固定参数和解释

| 项目 | 实现与来源 |
| --- | --- |
| 初始候选 / seed pool | 用户指定 N₀=3；N_seed=6 是本次实现选择，可显式增加，控制器校验足够覆盖后续未评种子。 |
| 首轮 / 后续 / 总轮数 | 按正文首轮只评 top3 seeds；后续每轮1 evolved+1 unused seed。A.2最多4轮，明确包含首轮；S=4 full Good提前停止。 |
| limitations | 最多16个extract/verify循环，按§3.1达到上限后保留已发现集合及未解决限制。 |
| engineering | subset和full分别最多2次工程修改，初始critic及每次修改后的critic单独执行。 |
| ablation | 每个下游best周期最多1次消融驱动改进；全部计划逐项执行，严格更优后重新规划/执行完整消融。 |
| peer review | Table5 Round0/1/2解释为初始review+最多2次补实验/改稿/重新review；score≥8提前停止。 |
| meta | 全运行最多1次meta驱动改进，返回下游时不重置此预算；不更优保留旧best及稿件并终止。 |
| PaperOrchestra | 固定官方commit，选择普通writer入口；3次技术尝试、3次content reflection、1次format repair，保留原Overall/分项gain-drop回退算法。 |
| ScholarPeer | 固定v2公开参考：3次文献扩展，10个问题；5 novelty+5 soundness是明确的实现分配，不冒称原文公开分配值。 |
| novelty | 两篇真实检索论文；Task先冻结量表，分数并列按生成顺序。量表/并列规则原文未公开。 |
| 模型/Harness | 示例gpt-6-sol/Codex是能力替换；原论文Gemini3.6Flash/Claude Code Opus4.8及其采样设置未被本例数值复现。 |

完整说明见 [执行协议](../../example/scientist-two/skills/scienceevolve-scientist-two/references/protocol.md) 与 [Skill 执行协议](../../example/scientist-two/skills/scienceevolve-scientist-two/references/protocol.md)。ScientistTwo没有披露所用PaperOrchestra commit、ScholarPeer版本及全部覆盖项；选定公开参考版本是可审查的实现决定，不能据此声称与原内部版本逐字相同。

## 方法到实现的逐项映射

48个执行角色加Main；所有角色均有真实SCIENCEEVOLVE路由、所需输入/输出/判断合同和证据要求。Main仅提交控制状态和分派，独立判断由对应角色完成。

| 方法能力 | 实现位置/验收 |
| --- | --- |
| 全部六个主阶段及失败分支 | `protocol.py` 的逐角色 transition；`contracts.json` 与workflow instructions；测试计数、Good/Bad/Engineer、零成功、S提前停止、全量Selector。 |
| 全部尝试与历史进化 | state事件journal保存每次角色输出/证据；idea_evolve读取成功和失败轨迹；代码/结果快照不能覆写。 |
| 消融/补实验无漏项 | planner返回动态数组，控制器逐项执行与spec过滤后汇总；测试每组三个计划全部被执行，不以固定一个计划代替方法。 |
| 严格改进门槛及旧最佳 | 独立Result Comparison；控制器只有Better更新best，等值/退化保留原best与论文；测试meta失败、预算耗尽、重新执行全部下游。 |
| PaperOrchestra内部 | outline、hybrid literature、figures、section writer、3个独立AgentReview+文本汇总/整数均值聚合、content refinement、format review/fix分角色；随附完整官方prompt/算法/工具/模板。测试接受/拒绝、编译失败、反思预算和格式回退。 |
| ScholarPeer内部 | summary、literature、3次expand、historian、baseline scout、两类question、逐问题answer及review角色；随附Appendix G完整prompt。测试全部10答案、每轮重新建context、novelty裁剪包无全文。 |
| CoE四项 | 实验后spec filter、最终score实际重跑、final spec audit、引用检索核验及method-code检查；Writer实际修稿/编译后重新审计。失败阻断，不填假PASS。 |
| 持久恢复 | 文件锁、atomic replace+fsync、证据hash、重复提交幂等、冲突/变更拒绝；SDK resume后next继续，外部作业按真实job ID恢复。 |
| SDK集成 | CLI workflow validate及research-examples实际load/stage完整Skill资源；不是仅检查JSON语法。 |

测试文件：[test_scientist_two.py](../../example/tests/test_scientist_two.py) 和 SDK 的 research-examples 测试。测试使用明确标注的离线fixture，只证明控制逻辑、证据约束和资源可搬运；不证明检索正确、科研判断正确或已运行实际模型/GPU/论文实验。

## 与计划底层功能的关系

当前SDK的Agent、Main弱路由和持久文件状态即可承载这套算法，不需要新增嵌套loop字段。强边全部返回Main，由控制器决定后继，避免SDK固定强边循环无法表示的条件嵌套。

Agent回退/workspace Git有助于恢复，但论文best保留通过不可变快照和版本指针实现，不需恢复旧Agent对话。并行讨论组可改善吞吐，但本例的科研决策、上下文和结果聚合完整保留，未把缺讨论组当不可实现理由。Novelty answer的信息隔离是角色输入协议，不是共享workspace的安全沙箱。

真实数据、模型凭据、算力、检索、LaTeX和PDF视觉工具是运行前提。外部服务不必重建到workflow内；缺资源必须blocked。外部作业提交不是控制器事务的一部分，须保存job ID并查询恢复，不能宣传外部执行exactly-once。Stanford Agentic Reviewer仅可用于另行授权的held-out评价，不接入优化反馈。
