# main 源码工作区导入验证（2026-10-05）

> 本文为当时版本的验收记录；当前版本已移除 legacy 引擎及相关测试。

> 历史证据说明：本页的历史实测命令、制品名、路径和来源链接按当时原文保留；正文中的当前接口名称已更新。新的命名与迁移边界见 [ScienceEvolve 命名迁移](naming-migration.md)。

分支 `feat/sdk-main-runtime-sync`；包版本仍为 `0.1.1`，不是正式发布。
上游 main 基线 `764257b3db49ebbcf6b08746278120adbe66a95e`；当前 runtimeRevision
`764257b3db49ebbcf6b08746278120adbe66a95e+5d5d3d16e3aab77f`。
内核 139 项 manifest 使用 7 项精确可逆的共用修复/扩展，Web 默认路径不变。

## 本轮实现

- 公共 main SDK `start({sourceWorkspace:{path,files?},...})` 与 CLI
  `--source-workspace` / `--source-files`，不添加 workflow JSON 字段，不改旧 example。
- Git 来源选 tracked 工作树普通文件；非 Git 来源必须显式白名单。不改源 HEAD/index/config/dirty 文件，
  不导入 history/hooks/.git/untracked。二进制、Unicode 和 CRLF 原文保留。
- 私有 manifest/blob 与创建前原子注册表绑定；raw application host 也保存显式无来源绑定。
  重试/恢复验证 manifest/blob SHA-256，main 原服务创建初始 commit 并验证 operation/source/tree。
  来源改动/移走不会改变首次快照；损坏/缺失失败，不退回默认空项目。
- batch hash-object 无 filter 写对象，不为每个文件 spawn Git。只写 runtime 自有 bare repository，
  不替代正式的 Agent checkpoint/PR/集成/完成判断。成果导出仍固定集成 main commit。
- 拒绝路径逃逸、链接/子模块、硬链接、目录 junction、凭据/依赖/管理路径、跨平台碰撞、超限文件。
  并发修改来源不是跨文件原子快照，源码内嵌秘密需用户审查。

## 验证结果

- SDK/main 类型检查通过；固定内核反向源码校验、构建和 CLI/消费者语法检查通过。
- 源码/导出/API/CLI/宿主/登记补丁相关 7 个文件，共 80 项全部通过；其中新增源码回归 20 项。
- main 共用初始化/授权/MCP 回归 9 项全部通过，默认 README 初始化和不同 source/tree 重试拒绝均覆盖。
- 最新 SDK 全量：43 个测试文件，42 通过 / 1 失败；546 项为 **541 通过 / 4 失败 / 1 跳过**。
  前一次为 540 通过 / 4 失败 / 1 跳过（545 项），增加宿主默认绑定保护回归后未新增失败。
  四个失败均为旧 `shared-workspace.test.ts` 创建文件 symlink 时 Windows `EPERM`，
  发生在夹具准备阶段，安全断言未执行。需允许创建文件 symlink 的 Windows 环境或其他系统重跑；
  未改全局权限/配置，未换 hardlink 或删除安全断言来宣称全绿。
- 仓库外 tarball 安装/API/CLI 烟测通过；真实编译 main MCP、SQLite、编译源码快照导入、
  移走来源后的 store 重开、重复 Git 初始化、二进制/CRLF 导出及默认 legacy 示例均通过。
  安装包消费者输出 `compiledSourceSnapshot: true`；没有依赖本机 main checkout。
- 实际任务链回归：模拟首次 GitHub 401 → 创建前保存 source 快照 → 修改并移走来源 →
  同 operation 授权重试 → 实际本地 Git 推送到隔离裸仓库 → 正式 resident 控制动作
  finish_task/complete_project → 成果导出 → 重开不重跑。provider/native 明确模拟，不是生产验收。

复现命令（各自仓库根目录；SDK 测试进程加入已安装 Git Bash PATH，并仅在进程内设置 SDK worktree safe.directory）：

```text
npm run typecheck -w @scienceevolve/sdk
npm test -w @scienceevolve/sdk
npm run build -w @scienceevolve/sdk
npm run smoke:package -w @scienceevolve/sdk
npm run typecheck -w @scienceevolve/server
npm test -w @scienceevolve/server -- tests/shared-runtime-fixes.test.ts tests/project-mcp.test.ts
```

## 验收边界

本轮实际执行本地 Git/SQLite、MCP 与 Node/CLI 安装包链路；GitHub provider 和 native 模型会话为
明确模拟。真实模型请求与真实 GitHub 请求均为 0，不等于收费模型或生产四 Harness 验收。
没有修改用户网关、Codex/CCSwitch profile、原 SDK 示例或已有运行数据，没有提交/推送/发 PR。
保留默认旧引擎：原生 profile/OAuth 和 SDK-only Loop/Evolver 迁移尚未完成；不借本次导入强行切换。
main 与 SDK 共享源文件修改仍在各自当前分支的工作区，尚未进入远端。
