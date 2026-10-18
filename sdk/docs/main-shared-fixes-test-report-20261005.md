# 共用内核修复与成果导出验证记录

> 本文为当时版本的验收记录；当前版本已移除 legacy 引擎及相关测试。

日期：2026-10-05；分支 `feat/sdk-main-runtime-sync`；包仍为私有开发版 0.1.1。
SDK 基线 `b0a4656`，main 基线 `764257b3db49ebbcf6b08746278120adbe66a95e`。
当前 runtimeRevision：`764257b3db49ebbcf6b08746278120adbe66a95e+dec7f97349c6497f`。
环境为 Windows / Node 24.20.0。未请求真实模型或真实 GitHub API，未推送、发布或提交。

## 本轮修改

1. 共用 Git 初始化诊断改为 `[ERROR_CODE]` 加脱敏消息，不再触发凭据 assignment 检查。
   main 与 SDK 都已修改，保护规则没有放宽；实际 SQLite 的 401/403 测试验证等待授权状态、
   原 operationId 重试、可恢复 Stop 和重新打开不重跑。
2. 共用源码 MCP 的 tsx import 改用 `pathToFileURL()`；同时补齐动态 fork 的
   `project-mcp-host`，避免静态 import 闭包遗漏。源码模式和安装包编译模式都有实际 MCP 调用验证。
3. manifest 升为固定基线加登记补丁、原始/当前 hash 和 runtimeRevision；精确反向还原
   上游 blob。旧预览数据缺少 revision 或 revision 不同会拒绝，不能静默升级。
4. 旧 SDK 修复 Windows 单反斜杠/盘符产物路径、源码 MCP；测试源码指纹只规范化 CRLF，
   不修改 golden fingerprint。原有 example JSON 保持不变。
5. 新 API `run.exportWorkspace()` 与 CLI `run export --output ABSOLUTE_NEW_DIR`：
   只导出已完成 Git 项目的集成 main commit，保留原文/二进制，不复制 `.git` 或未合并 worktree。
   新目标不覆盖旧目录；限制文件数量/大小并拒绝不安全路径、symlink、submodule、大小写冲突。
   取消导出不取消课题；失败保留部分目录，不自动清理。它不是源码导入。
   内部文件操作使用受控的真实仓库绑定，不从脱敏后的公开路径倒推；有实际 Git 回归覆盖。
6. 旧代理测试的 Windows 大小写环境变量断言按平台读取；目录 Skill 安全夹具用
   Windows junction / POSIX dir symlink，保留安全拒绝断言，不跳过用例或改变生产策略。

共用源码在本地 main 中修改两个源文件并增加一个回归测试；没有改其分支/HEAD、
已有 `server/temp` 或原 stash。SDK 核心修改通过声明补丁同步，不是私改副本。
没有修改本机 Codex/CCSwitch、网关密钥、业务运行数据或全局 Git/网络配置。

## 已执行验证

| 验证 | 实际结果 |
| --- | --- |
| core/schema 来源校验 | 139 项通过；两项共用修复能还原原始 SHA-256 |
| SDK/main TypeScript | 两边 typecheck 通过 |
| SDK 定向授权/宿主/MCP/旧运行回归 | 57 项通过 |
| 共用补丁、实际 main MCP、两类路径 | 5 项通过 |
| workspace / Git 集成 / CLI 定向回归 | 34 项通过 |
| SDK 全量，默认测试 PATH | **511 通过 / 13 失败 / 1 跳过**，42 个测试文件，共 525 项 |
| SDK 全量，配置测试进程 Git Bash PATH | **519 通过 / 5 失败 / 1 跳过**；此轮在目录 junction 夹具修复前 |
| 最终 SDK 全量，测试进程 Git Bash PATH | **520 通过 / 4 失败 / 1 跳过**；42 个文件、525 项，41 文件通过 |
| 代理测试，Windows 名称读取适配后 | 12 项通过，含真实 Bash 子进程 |
| 最后的 Git 导出 / Skill 定向测试 | 14 项通过，含脱敏路径绑定和 Windows junction 拒绝验证 |
| 本地 main 共用修复/MCP | 8 项通过 |
| main Git provider 回归 | 有限 60s test / 30s hook 时限，49 通过 / 1 CRLF 断言失败；不修改断言 |
| SDK build | 通过 |
| 仓库外 tarball 安装/API/CLI | 通过；实际 SQLite、编译 MCP round trip、编译本地 Git 导出、新入口保护及旧 CLI/profile/env/原例子 |

默认 PATH 的 13 项失败为旧环境条件：8 项测试找不到 `bash`；5 项测试无权创建 symlink（EPERM）。
其中 shared-workspace 的路径断言已通过，继续执行到原 symlink 夹具时才失败。
第一次默认 PATH 全量相比阶段三修复了 10 项原失败。后续补齐测试环境与平台夹具，
最终剩余 4 项文件 symlink EPERM 和 1 项已登记的权限跳过；不能把本轮全量报告称为全绿。
本机有 Git Bash，已做仅测试进程 PATH 配置的核验，不修改全局 PATH。
配置 PATH 的首次代理测试为 10 通过 / 2 失败；剩余两项由 Windows 子进程折叠
`HTTP_PROXY`/`http_proxy` 引起，代理值实际继承。测试改为在 Windows 读取任一大小写名称，
POSIX 仍读取原小写名称；原来的直接模式无代理断言及产品代码不变。
适配后代理用例全部通过。目录 symlink 夹具已改为 Windows junction 并实际通过；
其余 4 项文件 symlink 仍需要系统权限，不能用普通文件或 hardlink 冒充验证。
复现最终全量：仅为 PowerShell 测试进程将已安装的 Git Bash `bin` 加入 PATH 后运行 `npm test -w sdk`。
构建脚本另需本机 worktree 的 process-only safe.directory；没有改变全局 Git 信任目录。
原有 main Git provider 的默认 5s 时限曾导致多个超时/EBUSY；重跑后只剩 CRLF，
证明不能把首次测试时限失败直接归为授权修复回归。

安装包验收使用仓库外临时 consumer；模型/native 响应和 provider 是确定性夹具。
Git 对象、MCP 进程和 SQLite 是真实执行，**真实模型/GitHub请求次数为零**。
本报告在取得结果后生成；本轮 tarball 已验收的实现不因此变成一次新的发布。

## 仍未完成

- 原生 profile/OAuth：main 普通/常驻 Harness 路线都要求 gatewaySnapshot，仍需公共路线、
  session/recovery 和权限接口一并适配；不能拿 OAuth token 冒充 API key 或绕过连接测试。
- 源码 workspace 导入：需在受控 Git 初始化中保留来源快照、忽略/秘密策略和幂等恢复，
  不会偷偷将旧 `--workspace` 改为另一份 worktree。最终交付导出已经可用。
- 原 SDK-only Loop/Evolver 与 v3 的兼容、默认入口切换、真实多 Agent/GitHub 与 Linux/macOS 验收。

旧 API/CLI 仍默认 legacy，新内核显式 opt-in。上述未完成项不是已经通过的功能，
不能仅凭本地模拟验收宣布完全替换旧 SDK。
