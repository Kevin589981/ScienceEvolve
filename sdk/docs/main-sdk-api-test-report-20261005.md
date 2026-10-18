# main SDK API 第二阶段验证记录

> 本文为当时版本的验收记录；当前版本已移除 legacy 引擎及相关测试。

> 历史证据说明：本页的历史实测命令、制品名、路径和来源链接按当时原文保留；正文中的当前接口名称已更新。新的命名与迁移边界见 [ScienceEvolve 命名迁移](naming-migration.md)。

此为阶段二历史记录；显式 CLI 见 [阶段三记录](main-cli-test-report-20261005.md)，共用修复和最新结果见 [阶段四记录](main-shared-fixes-test-report-20261005.md)。

日期：2026-10-05；分支：`feat/sdk-main-runtime-sync`。
来源仍为 main `764257b3db49ebbcf6b08746278120adbe66a95e`，SDK 基线 `b0a4656`。
没有推送/发布，没有修改 main 源码、用户项目、网关、登录配置或全局 Git 设置。

## 新增内容

- 显式 `@scion-ar/sdk/main` API；默认根入口和 CLI 保持原引擎。
- main 原生 v3 配置校验/规范化、预设加载、相对 Skill 路径和部署侧网关绑定。
- RunHandle 的创建、查询、事件回放、等待、暂停/恢复、Stop、输入、响应及 Git 初始化重试。
- 保留 Git、任务、执行、PR、scoped 并行状态、epoch 身份和失败/重试历史；外部输出/异常凭据脱敏。
- lower native adapter Stop guard，补齐 production decideRoute 内部 closure open 的停机跟踪。
- v3 执行→审计配置示例、迁移指南和仓库外安装包消费者。

## 验证覆盖

新接口定向测试验证了配置往返、Git-off 完成、Git-on 初始化/管理完成、分页重连，
观察者 Abort 不取消任务、close 唤醒消费者/释放订阅、失败 Stop 重试、状态/事件/错误脱敏，
以及拒绝未支持的 workspace 与 executable+args（创建项目之前拒绝，不静默丢弃）。

Git-on 成功场景使用**实际本地 Git、实际 SQLite、main 正式 coordinator/input builder/dispatcher，
以及 main 正式 resident launcher**；仅底层 native turn 和 GitHub fetch/远端 transport 使用测试夹具。
HTTPS Git transport 重定向至 mkdtemp 创建的本地 bare remote，所有工具调用和提交/分支机制真实执行，
没有网络 GitHub 写入，也没有推理请求。Main 通过 ControlActionService 实际提交 finish_task 和 complete_project，
项目完成后重开目录，确认没有重新打开 resident 或重跑任务。

这项测试是 bounded Main-only 机制验收；不能代替多 Agent 的真实 PR/冲突/研究质量验收。
多 Agent 本地 worktree、SQLite 并发、ownership/epoch、PR 事实约束仍由第一阶段引入的上游回归覆盖。

## 发现的 main 问题与语义差异

### 授权错误 checkpoint（仍未修复）

真实 main 内核配合模拟 HTTP 401，可复现：

1. provider 产生 `GitHubAuthorizationError`，代码为 `GITHUB_WAITING_FOR_AUTHORIZATION`；
2. 初始化把 `code: message` 存入 `initialization.error`；
3. `containsCredentialMaterial` 中 credential assignment 正则匹配 `FOR_AUTHORIZATION: ...`；
4. 状态库拒绝错误 checkpoint，`git.status` 留在 `authorizing`，项目 `paused` / `git:failed`；
5. failureAttempts 保留原失败，SDK 重试和 resumable Stop 仍走 main。

回归测试明确断言这个**已知缺陷的现状**，不是断言“401 正常进入 waiting_for_github”。
通过测试不能解释为授权问题已修复。没有通过改 SDK core、吞错或伪造网关/Git 成功来绕过。
应由共用 main 内核先修复该错误表示，再更新固定来源及期望断言。

### main 的 F13 Stop 与事件

Git-on cancel 是保留执行、session 和 Git 现场的 resumable Stop；返回 paused，
phase 为 collaboration:user-cancelled，并持久化 project.cancellation.stop_confirmed。
它不写终态 cancelledAt/cancellationSettledAt。Git-off cancel 的终态规则保持 main 原行为。

Git-on 完成事件保留 main 的 node.completed/sourceType 等事实，不能要求旧 SDK 的单一 project.completed 事件。
项目终态应读 wait/snapshot；事件身份、sourceType 和 epoch 不在适配层重命名或删除。

## 结果

| 检查 | 结果 |
| --- | --- |
| typecheck | 通过 |
| 内核来源校验 | 138 项 manifest 记录通过；正式 core 未改变 |
| 新接口及宿主定向用例 | 31 项通过（包含已知 main 授权缺陷的现状复现，不等于该缺陷修复） |
| 最终全量 | 442 通过、23 失败、1 权限跳过（466 项；38 个文件） |
| 仓库外 tarball | 通过：新 main API/v3 示例/Pi/脱敏/目录锁；原内部宿主、旧 API/CLI、原生 profile/env、网关四阶段、AHE 与软件开发示例兼容检查 |

23 项失败与第一阶段旧基线 `b0a4656` 已复现的集合一致，没有新增失败，
也没有跳过旧失败来制造全绿。分类、源码 MCP 的 Windows file URL 问题及基线快照对照
见 [第一阶段记录](main-runtime-test-report-20261005.md)。
唯一跳过仍为当前 Windows 账户无权限创建文件 symlink 的内核保护用例。

外部安装消费者与本轮 tarball 保留在系统临时目录的
`scienceevolve-sdk-consumer-Xhxa7A`，不是用户业务项目。包消费只执行模拟模型/provider 场景。
测试源码中直接写入的网关/credential 均为明确的 fixture 值，没有回显用户密钥。
构建使用仅当前子进程生效的 safe.directory 配置处理已有 worktree 的用户归属差异，
没有更改全局 Git 信任设置。

## 验收边界

未完成 CLI/default 切换、原生 profile/OAuth、新 Git 工作区导入/最终交付路径，
没有升级旧 SDK/Web 数据，没有声称全量回归已通过。
没有真实模型、真实 GitHub 写入、Windows 原生 resident 完整矩阵或 Linux/macOS 验收。
