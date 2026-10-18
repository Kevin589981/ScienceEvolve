# SDK main-runtime 同步计划

基线：SDK `b0a4656`；main `764257b3db49ebbcf6b08746278120adbe66a95e`（2026-10-05）。
当前开发分支：`feat/sdk-only-v0.1.1`。本轮仅本地修改，不发布、不改运行中的服务/用户网关。

2026-10-06 进展：现有 example/配置 Skill 已迁移到默认 main；Git-off workspace 原地执行，
Git-on workspace 导入原项目后隔离执行、正式完成安全回写。sourceWorkspace 仍只读。
串行/并行 worktree 策略未改；外部 Git-off 重配置提案独立存放，不覆盖根 workflow.json。
下方历史验收计数保留，当前合同见 [main CLI](../../sdk/docs/main-cli-zh.md)。

## 目标与边界

复用 main 的执行内核，不重写 Git、协作调度、SQLite 状态、常驻会话或任务完成规则。
SDK 保持 Node API/CLI、自包含安装包和无 Web/Express 依赖；应用宿主负责配置与凭据注入。
`application/main-runtime` 是同版本内部适配入口，不是稳定公开 API。
第二阶段另提供显式 `@scienceevolve/sdk/main` 入口，
根入口/CLI 默认 main；旧实现用 /legacy/--engine legacy，现有 example 已显式迁移而非运行时偷偷转换。

源码位于 `sdk/src/core/`，由固定 main 提交加登记的共用修复/可信宿主扩展提取。
`sdk/resources/main-runtime/manifest.json` 记录原始/当前 SHA-256、runtimeRevision 和必要资源；
`shared-fixes.json` 的精确替换可反向还原原始 blob。修复已同时修改本地 main 共用源码，尚未提交。
`node sdk/scripts/sync-main-runtime.mjs --check` 不依赖 main 工作目录，校验源码与资源是否被改写。
宿主适配不得通过修改这份内核副本改变执行语义。

## 实施顺序

1. 内核及独立宿主：提取模块依赖闭包，接通 main 的 Orchestrator、CollaborationRuntimeCoordinator、
   HarnessRuntimeFacade；补齐 SQLite 生命周期、目录锁、包内 schema/原生辅助文件和一致性测试。
2. 配置与 SDK 接口：接通 v3 workflow、Git 凭据、并行执行状态、暂停/停止/恢复及事件接口。
   公开 API 不接收 Web OAuth 密钥；Git API 与 transport 必须使用同一项目绑定凭据。
3. 网关与原生 profile：保留 env/profile，不修改本机配置，不把 OAuth 登录伪造成 API-key 网关。
   已为 Codex 普通/常驻入口接入独立原生 profile binding；API-key 路线保留 gatewaySnapshot，
   未支持的组合要明确拒绝，禁止伪造“已验证”状态。
4. 工作区与 CLI：Git-off --workspace 原地执行；Git-on 导入当前安全源码、使用现有 worktree，
   正式完成后安全回写原目录，冲突不覆盖，不改原 .git/index。区分源码、执行副本和私有状态。
5. 兼容性与验收：显式迁移现有 example JSON/配套 Skill，复核 Loop、Evolver、任务级 Skill/MCP 和自行管理 Git 的研究模板；
   覆盖并发、原 session 恢复、Git 不确定结果、原 writer 停止证明和完成凭据。
6. 切换与收尾：公开 SDK/CLI 默认接入同款内核后才移除不再使用的旧实现；更新迁移说明、
   版本与测试报告。旧运行数据不自动转换；main 与 SDK 的同款 Git-off/Git-on 分流保持一致。

## 验收层级

- 源码一致性：依赖闭包与固定提交及登记补丁完全一致；没有 app.ts/index.ts 或 Express；必需资源进入 tarball。
- 本地机制：实际 SQLite、实际本地 Git、正式内核；模拟 provider/native 场景需明确标记。
- 安装包：仓库外安装，验证真实 Node 子进程、模块导入、生命周期和资源查找。
- 真实验收：最终安装包使用真实模型与真实 GitHub，另测 Windows/Linux/macOS。
  本地单测、fake provider 或模拟 native 不等于真实模型/真实 GitHub 验收。

## 必须保留的行为

- Agent 显式发起 Git 工具与 finish_task；自然返回不是任务完成。
- 所需 PR 合并及本地同步确认后才放行后继；其他独立路径不因单一路径失败而被回滚。
- operation/ownership/coordinator/writer 身份校验和幂等结果不得缩减。
- 保留原 Agent、目录、session、报告和已合并事实；恢复不重跑已完成的业务。
- 非 yolo 权限支持不足时 fail closed，不退化为 prompt 限制。
- SDK close 先确认运行时停机并关闭状态库，再释放目录锁。

## 进度

- [x] 固定提交的内核依赖闭包及资源导入（143 项 manifest，包括动态进程/MCP 入口，SHA-256 校验）。
- [x] 独立 main-runtime 宿主和生命周期测试（实际 SQLite、目录锁与引擎标记、Stop guard）。
- [x] 内核机制与 tarball 回归（199 通过、1 权限跳过；仓库外安装包验证通过）。
- [x] 显式 main API：v3 校验、部署网关绑定、RunHandle、并行/Git 投影、事件、Stop/重试与输出脱敏。
- [x] 本地端到端 Git-on：实际 SQLite/Git + 模拟 GitHub/native，正式 finish_task/complete_project，重开不重跑。
- [x] 显式 main CLI：独立 dataDir、部署文件/网关绑定、v3 校验、前台事件、Git 重试与 resumable Stop。
- [x] 公开 options/runtime JSON 白名单校验；凭据只在内存或环境变量引用中注入。
- [x] 共用 Git 授权 checkpoint/MCP file URL 修复、动态 fork supervisor 闭包与实际 revision 数据保护。
- [x] 完成任务的 workspace 导出：固定集成 main commit、新目录、不覆盖来源、不隐式合并。
- [x] 只读源码导入：tracked/显式普通文件、私有快照、创建前绑定、同 operation/source/tree 重试，不改源目录或 Git 历史。
- [x] 四 Harness 的显式 API-key env/profile 只读导入，不改本机配置、不伪造 probe。
- [x] Git-off main Loop/Evolver 实际内核验证：黄金批次、暂停恢复、prompt/预算进化与拒绝路径。
- [x] 原生 OAuth 独立路线、默认 SDK/CLI、legacy 回退，现有 example/Skill 的显式迁移。
- [x] CLI/API workspace：Git-off 原地工作，Git-on 原项目导入、正式集成成果回写，冲突保护/显式重试。
- [x] 外部 workspace 重配置提案隔离，保留用户根 workflow.json。
- [x] Windows 上安装包默认入口的 Git-on scoped Evolver 有界真实验收：prompt 修改、成员与最终 PR、正式完成、集成导出、真实 Python 测试和重开不重跑。
- [ ] 真实四 Harness/跨平台矩阵。

不宣称跨平台/四 Harness 全面验收。默认切换是显式兼容性变更，旧数据/配置仍选择 legacy。

已引入 5 组 main 回归及 2 个辅助夹具，原始 sourceSha256 与 SDK 版本 sha256 都记录在 manifest。
除了 import 路径，Git 测试还存在明确记录的夹具适配：临时仓库关闭 autocrlf、Windows 目录 junction、
文件符号链接 EPERM 时显式跳过、有限 30/60 秒时限及临时目录删除重试。测试适配没有改变业务规则；
正式内核仅另应用 manifest 声明的共用修复/扩展；trusted hook 不成为 HTTP/Workflow/Agent 输入。

第三阶段全量有 23 项旧基线失败。本轮实际修复其中的 Windows MCP/路径/指纹问题；
默认测试 PATH 首次为 511 通过 / 13 失败 / 1 跳过；配置测试进程 Git Bash 并修正平台夹具后，
最终为 520 通过 / 4 文件 symlink 权限失败 / 1 跳过，见
`sdk/docs/main-shared-fixes-test-report-20261005.md`，历史报告保留原始计数。
历史源码快照轮当时未支持 --workspace；2026-10-06 已接通上述 workspace 合同。另支持四 Harness API-key env/profile 的
显式只读导入及 Git-off main Loop/Evolver 验证。原生 OAuth 普通入口真实验收已通过；
常驻 Git-on 验收与默认入口回归见
[本轮报告](../../sdk/docs/main-oauth-git-evolver-default-test-report-20261005.md)，旧报告计数不覆盖。
最新全量 585 项：580 通过、4 个旧 Windows 文件 symlink 夹具权限失败、1 跳过。

源码导入轮最终 SDK 全量为 541 通过 / 4 旧 Windows 文件 symlink 权限失败 / 1 跳过（546 项），
相关 7 文件的 80 项和 main 共用 9 项均通过。构建及仓库外编译源码导入/导出烟测通过；
不把模拟 provider/native 结果当作真实模型或 GitHub 验收。

API-key profile / Loop 轮最终 SDK 全量为 561 通过 / 4 个同样的 Windows symlink 夹具权限失败 /
1 跳过（45 文件、566 项），新增 20 项全部通过。类型检查、构建及仓库外安装包 API/CLI 导入烟测通过。
本轮未改 main 内核字节或来源 revision，也没有改写旧 example、用户 profile 或网关配置。

第二阶段发现固定 main 的授权 checkpoint 缺陷：`GITHUB_WAITING_FOR_AUTHORIZATION: ...`
被状态库当作凭据 assignment，401/403 会停在 `authorizing` + `git:failed`，不是正常 `waiting_for_github`。
本轮已修改共用源码诊断格式，并用实际 SQLite 验证 401/403 保存正确等待状态、同操作重试和 Stop。
凭据检测仍会拒绝原 assignment，不伪造授权通过；SDK 通过登记补丁同步，而不是私改 core。
另补 lower native adapter Stop guard，覆盖 production decideRoute 的内部 closure open。
公开 cancel 保留 main 的 F13 resumable Stop 语义，不伪装成 Git-off terminal cancel。
