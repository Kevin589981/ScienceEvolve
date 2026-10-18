# SDK 工作目录适配与 Windows 验收记录（2026-10-06）

> 本文为当时版本的验收记录；当前版本已移除 legacy 引擎及相关测试。

> 历史证据说明：本页的历史实测命令、制品名、路径和来源链接按当时原文保留；正文中的当前接口名称已更新。新的命名与迁移边界见 [ScienceEvolve 命名迁移](naming-migration.md)。

这是本次 SDK-only 工作的脱敏记录，不包含网关密钥、GitHub token 或原生登录资料。旧报告保留为历史证据，不修改其当时的测试结论。本轮源码交付到现有 `feat/sdk-only-v0.1.1` 分支，不创建 PR、不合入 main；未发布 npm 包，也未修改 main 前后端。

## 这次解决什么

新引擎直接接受 CLI `--workspace 路径` 和 API `sdk.start({ workspace: absolutePath, ... })`，指定工作目录不再要求切换 legacy。

| 配置 | 执行时在哪里工作 | 什么时候更新原项目 |
| --- | --- | --- |
| 不开启 Git，指定 workspace | 所有 Agent 直接使用原目录 | 文件操作即时作用于原目录 |
| 开启 Git，指定 workspace | 从原目录当前文件建立快照，使用现有隔离 worktree | 任务正式完成、成果集成到受控 main 后，自动回写原目录 |
| 仅 sourceWorkspace | 只读导入指定文件，使用受控工作目录 | 不自动回写；完成后可显式导出 |

串行/并行时每 Agent 的 Git worktree 策略保持原样，没有增加“串行原地执行”的分支。workspace 是代码和产出的目录，dataDir 是 SDK 私有状态、日志、会话、网关和 Git 运行记录的目录；两者必须分离且不能互相包含。旧 dataDir 与不同 runtimeRevision 仍不自动迁移。

## 原目录的保护和恢复

- Git-on 导入已有 Git 仓库的当前工作树文件，包含未提交修改和非忽略的新文件，不对原 `.git` 执行 commit、reset、pull，也不更改原暂存区。
- 不复制 `.git`、依赖/运行管理目录及已识别的凭据文件；拒绝符号链接、junction 逃逸、hardlink、submodule 和不安全路径。导入/导出上限为 5000 文件、单文件 32 MiB、总计 256 MiB。不是任意大小项目的通用镜像工具。
- 回写有独占锁、完整差异预检、持久日志、原文件备份和逐文件原子替换。预检发现冲突时，不开始该轮文件替换；替换过程中失败会保留已完成部分和恢复日志，并不声称整个目录原子回滚。
- 回写不覆盖用户运行期间另行修改的冲突文件。解决后调用 `run.syncWorkspace()` 或 CLI `run sync-workspace RUN_ID`；也可另行导出成果。
- 快照中的 `workspaceDelivery` 区分 pending / applying / synced / conflict / failed。只有 synced 才表示原目录交付成功。追加新需求后的下一轮会重新建立完成代次，不重复回写旧代次。
- 掉电/强杀后如有遗留锁，须先确认原进程已经停止，再人工处理；不会自动删掉其他进程的锁。原目录的外部编辑不是 SDK 管理的事务，实际交付期间不要同时编辑该目录。

## workflow.json、示例和 Skill

原目录已有的业务 `workflow.json` 不再导致拒绝启动，也不会被 Main 当作重配置提案覆盖。Git-off 外部目录的提案放在 `.scienceevolve/management/<invocation>/proposal/workflow.json`；实际地址写入本轮 Inbox。官方 `apply_workflow(path: "workflow.json")` 的逻辑别名保持兼容。

仓库已有 16 个根 example 和 SDK default 配置已迁移为 main Git-off，保留原有 Agent、指令、路由、循环与终止设计。旧配置 fixture 单独保留用于 legacy 回归。

增加了三个机制示例：已有项目“实现 → 独立审计”、受保护的工作流重配置、Git 并行审计。用法见 [workspace 示例说明](../examples/workspace-examples.md)。配置编写 Skill 的模板、字段和操作步骤已经更新为 main、显式部署网关和 Node 24；历史规划/旧引擎文档已标注适用范围。

**这不等于补齐 README 的七项具名科研方法 TODO。** 通用并行审计不是 AlphaEvolve、Raven 等方法的完整复现；这些条目仍需逐例补齐完整流程、外部工具与研究验证，不能勾成已完成。

## 本地回归

环境：Windows，Node 24.20.0，npm 11.19.0。固定 main 来源为 `764257b3db49ebbcf6b08746278120adbe66a95e`；本次 SDK 宿主扩展按精确可逆补丁登记，不直接修改 main 工作树。

本轮提交前拉取并合入云端 `56f3651` 的示例/Skill 迁移，保留其逐模型 high/xhigh 思考选项、代理配置和方法语义校验，同时修正旧 workspace 说明。合并后重新回归：58 个测试文件通过，673 项通过、2 项跳过（共 675 项），类型检查与 143 个固定运行时资源来源/补丁校验通过。运行时为 `764257b3db49ebbcf6b08746278120adbe66a95e+773a166c6d338505`；下文真实模型/GitHub 证据来自本轮已完成的验收，未因文档和示例合并再次调用付费模型。

合并后构建与独立安装包/API/CLI 回归再次通过：仓库外 npm 安装，实际 SQLite、分进程 CLI、编译后的 MCP/本地 Git 导出、workspace 重开、新默认入口、legacy 兼容、已迁移示例与两种旧 fixture 均完成检查。模型/provider 在该组中仍为模拟。安装包包含新回写模块、使用说明、Skill、三个新增机制示例和本报告；消费者目录为仓库外临时目录（本次 `scion-ar-sdk-consumer-38gFmC`），未发布 npm。源码交付不包含安装包或运行数据；正式分发时由分支最新源码重新打包。

覆盖包括：真实本地 Git 的项目导入/差异回写、冲突不覆盖、删除、目录身份替换、外来锁、部分写入失败后重试、完成代次；实际 SQLite/内核的自动回写及重开不重跑；Main 重配置提案隔离；真实 Windows junction 边界；已迁移示例的加载和模拟运行。另复现并修复了 `constructor` / `toString` / `__proto__` 文件名被对象原型误当作基线记录的问题，覆盖这些文件的交付、中断恢复和后续删除。

其中模型、GitHub provider 或原生进程被模拟的测试只验证合同，不作为真实模型/GitHub 通过证据。旧 Windows 文件 symlink 的权限受限测试明确跳过，不以 junction 替代测试冒称 file symlink 已通过。

## 真实模型验收：Codex、Pi、DSH

按用户要求排除 Claude Code。模型使用用户指定网关中实际列出的 `gpt-6-luna`；没有更改用户原生 Harness 配置。收费模型调用、专用私有 GitHub 测试仓库均为明确授权的隔离验收。

| Harness | 文本普通/流式、工具普通/流式 | 官方工具调用及配对结果 sentinel | 原 workspace 写文件并正式完成 |
| --- | --- | --- | --- |
| Codex 0.152.0 | 通过 | 通过 | 通过 |
| Pi 0.74.2 | 通过 | 通过 | 通过 |
| DSH 0.2.0-rc.2 | 通过 | 通过 | 通过 |

三个任务均保留原 `seed.txt` 和根 `workflow.json`，生成真实结果文件；不是只调用 HTTP 200 就算成功。Pi 的通过记录来自前一轮 runtimeRevision，Codex/DSH 来自修复后的同一轮，不能描述为三个 Harness 在每一个中间版本都全量重测。

DSH 另有一次关闭 SDK 后重开、追加需求的真实验收：任务再次正式完成，生成第二个结果文件，并核对沿用同一个原生会话 ID。

原始逐阶段、事件与失败记录留在仓库外 `D:/openfars/sdk-acceptance-workspace-20261006-*` 专用目录；这些目录含私有网关配置，**不得整体提交或分发**。

## 实测发现并修复的问题

| 实测故障 | 原因与修复 |
| --- | --- |
| Windows 只读 Harness smoke 被 Bash 代理拦住 | sentinel 探测不需要 shell；该探测使用 inherit，不改变真实任务的 shell 权限 |
| DSH provider 不存在 | 当前 CLI profile 未按旧 settings.yaml 路由；生成调用专属 provider patch，密钥仍由环境提供 |
| DSH 会话文件找不到 | 当前 CLI 使用 session.v4.jsonl.zstd；安全解析版本化文件，并校验 header/session/workspace |
| DSH 原目录任务/恢复失败 | 显式映射已有权限配置；使用官方 native resume 插件与 RPC，不复制历史来伪造持续会话 |
| Codex 未知网关模型不调用普通工具 | 原生 catalog 未包含该模型，回退为 code-only；调用专属普通工具 catalog 保留实际 model ID |
| Codex 探测成功但外部 workspace 启动被拒绝 | 旧驱动仍只允许状态目录内路径；仅允许可信 SDK 注册表绑定的精确外部目录，任意路径仍拒绝 |
| GitHub 工具提前报 frontdoor 超时 | GitHub 单请求预算 30 秒，但两层控制通道仅 10 秒；工具下游/代理/native 等待预算按 180/185/210 秒分层，初始化/发现仍 10 秒 |

新增实际 stdio/loopback 回归：模拟 provider 11 秒后返回，验证不会再被旧 10 秒通道提前截断；此测试不等于 GitHub 网络测试。GitHub 网络本身失败仍应保留暂停、操作日志及不确定结果，而不是假装成功或直接跳过交付。

## Git-on 三 Agent 真实闭环

独立私有测试仓库，Main 负责管理、execution 实现加法与三个 unittest、review 独立审计。检查正式业务提交、PR 与组集成、最终 main 集成，再验证原 workspace 自动收到结果、原配置不变；最终 Python 测试由宿主真实执行，不能把模型静态审计说成已运行测试。

最终结果：2026-10-06 18:51（北京时间），任务正式 `completed`，原目录 `workspaceDelivery.status = synced`，回写 4 个成果文件，完成代次为 0，集成 commit 为 `cf47cecd169db9d09c33b7d45212d27cdc9701c3`。实现、审计、组到 main 的 3 条真实 PR 均已合并并同步；原 `seed.txt` 和 `workflow.json` 内容保持不变。

宿主在自动回写后的原 workspace 中真实执行 Python unittest，确认 **运行 3 项且全部通过**；另外执行正数、负数、零的 **3 项独立断言**，全部通过。不能将审计文件中的静态检查替代这组宿主执行结果。

随后关闭并重开相同 dataDir，任务继续保持 completed / synced，宿主测试再次通过；原生调用绑定记录数量重开前后均为 23，没有重新运行已完成的 Agent。事件订阅回放历史记录不等于重新创建任务或再次调用模型。

旧两轮记录包含 GitHub 网络失败与 10 秒控制通道问题；结果为暂停而不是通过，均保留诊断。修复后的闭环也遇到模型换操作 ID、漏做暂存/业务提交、改写完成收据的问题，使用正式 operator response 指导保留任务恢复。验收脚本每次等待达到 15 分钟上限后关闭 SDK 并重开原任务；这不是 SDK 固定总超时。通过 `git_reconcile_push` 核对两条旧推送记录、通过 `github_merge_pr` 同步已合并审计 PR，并保持原完成收据后，流程才正式推进最终集成。没有手改数据库、制造 Agent 业务提交或绕过交付条件。

本轮后续恢复为隔离验收宿主启用了有界 GitHub **只读**网络重试：仅 GET/HEAD 的传输失败最多增加两次尝试，并受原请求 AbortSignal 限制；不会重发 POST/PATCH/PUT/DELETE 或模型请求，不修改 SDK provider 默认实现，也不会把 HTTP 错误改为成功。验收脚本保留了网络重试标记。**本轮是含操作员指导的真实恢复闭环，不是一次无人干预成功**，也未重新验收 Git-on Evolver 自修改。

## 未验证/未完成范围

- Linux/macOS 没有可用环境，未验收。当前非 yolo Git 文件隔离仍有平台限制，不能声称四 Harness/三平台全通过。
- Claude Code 按用户要求不参与本轮，不代表已修复或已验收。
- 文件 symlink 权限受限路径未实际跑通；junction 拒绝和其他目录边界有真实 Windows 回归。
- 本轮真实任务规模小，不代表长期高并发、所有模型、所有 Harness 版本、全量科研 example 或完整 Evolver 矩阵已通过。
- README 的七项具名方法 TODO 尚未补全；旧状态迁移仍不在本次实现范围。

当前使用文档见 [main CLI/API](main-cli-zh.md)、[工作目录迁移说明](main-runtime-migration-zh.md)、[配置编写 Skill](../skills/scienceevolve-sdk/SKILL.md)。
