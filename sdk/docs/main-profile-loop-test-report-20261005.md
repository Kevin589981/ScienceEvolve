# main SDK API-key profile / Loop 验证记录

> 本文为当时版本的验收记录；当前版本已移除 legacy 引擎及相关测试。

> 历史证据说明：本页的历史实测命令、制品名、路径和来源链接按当时原文保留；正文中的当前接口名称已更新。新的命名与迁移边界见 [ScienceEvolve 命名迁移](naming-migration.md)。

日期：2026-10-05。Windows / PowerShell 7 / Node 24，SDK 0.1.1 开发分支
`feat/sdk-main-runtime-sync`。固定内核 `764257b3db49ebbcf6b08746278120adbe66a95e`，
runtimeRevision `764257b3db49ebbcf6b08746278120adbe66a95e+5d5d3d16e3aab77f`。

## 实现范围

- 新增 `sdk.gateways.importHarness({ harness, model, source, profilePath?, environment?, name? })`
  和 CLI `gateway import`，支持 Codex/Pi/DSH/Claude Code 的一次性 API-key env/profile 导入。
  显式来源、只读 native reader、main 网关校验/保存、输出和错误脱敏；不执行 credential helper
  shell、不改 config/auth 或 CCSwitch、不发起 probe、不伪造通过状态。
- 不是 live profile 绑定。API key 保存于私有 dataDir；重新导入返回新网关 ID，须重新测试并选择它。
  OAuth-only profile 明确拒绝，不提取 access/refresh token 充当 API key。
- Loop/Evolver 复用 main 已存在的 Git-off v2 逻辑，未创建第二个调度器，也未放宽 Gateway 检查。
  首次自进化夹具缺少精确网关通过记录，main 正确拒绝；之后补充显式模拟 route/smoke 验证，
  而非删除校验。新测试区分 main 的 Agent 重配置 capability 与旧 SDK 的同名兼容字段。

## 实际结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck -w sdk` | 通过 |
| `npm run build -w sdk` | 通过，139 项来源 manifest 一致 |
| `npm test -w sdk` | 45 文件：44 通过、1 失败；566 项：561 通过、4 失败、1 跳过 |
| 本轮新增 20 项 | 12 profile/env + 6 Loop/Evolver + 2 CLI，全部通过 |
| 相关 5 文件（全量运行中） | 58 项全部通过 |
| `npm run smoke:package -w sdk` | exit 0；仓库外 tarball 安装及实际编译 API/CLI/SQLite/MCP/Git 验证通过 |

全量四项失败与上一轮相同，均为 `shared-workspace.test.ts` 创建文件 symlink 时的 Windows EPERM，
失败发生在夹具准备，未执行对应安全断言；没有删除断言或记作成功。既有 local-Git 测试另有一项
符号链接权限跳过。测试进程临时加入已安装 Git Bash PATH，并设置当前 worktree 的进程级
safe.directory；没有修改系统 PATH、Git 全局配置或权限。

## 覆盖详情

profile/env：四 Harness 的来源选择、context、API-key 脱敏、profile 原文/mtime 保留、
不创建额外 native 文件、不发起 fetch、OAuth 拒绝、不 fallback、shell helper 拒绝、
非法/混合来源、关机后的操作拒绝。

Loop/Evolver：两批调用顺序和计数/事件与旧黄金向量一致；安全点暂停再重开不重置批次，
不重跑已提交的迭代；Main/Worker prompt 和批大小原子修改、Session 刷新、完成历史重开不运行；
锁定权限修改被拒绝且 prompt 不部分提交；关闭 Evolver 不暴露 capability；非法拓扑/预算拒绝。

安装包：独立消费者实际调用编译后的 `importHarness`，保存并重开脱敏网关；实际 CLI 子进程
从隔离 Codex config.toml 读取 API-key env 引用，校验 native 文件内容保持不变。
同时通过既有 main 源码快照/导出、MCP、SQLite 与旧 SDK API/CLI/原 example 烟测。
消费者目录保留于系统临时目录 `scion-ar-sdk-consumer-MYEvPE`，仅含隔离测试数据与假凭据。

## 边界与未完成项

真实模型请求、真实 GitHub 仓库/PR 操作均为 0。Agent、upstream、adapter smoke 为明确模拟，
SQLite、本地 Git、Node 子进程及 tarball 安装为实际执行。仅验证本机 Windows，不能声称跨平台验收完成。

原 example JSON 未修改；main 新入口仍拒绝旧 gatewaySource/原地 workspace，默认 API/CLI 引擎仍为 legacy。
原生 OAuth 路由、旧 example 部署迁移、Git-on scoped Evolver 完整验收和默认入口切换仍未完成。
本轮未改固定 main 内核字节、用户 profile/网关/运行数据，未提交或推送 Git，未创建 PR。
