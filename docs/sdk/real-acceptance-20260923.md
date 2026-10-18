# SDK 真实网关与 Harness 验收（2026-09-23）

> 历史记录：当前 SDK 已移除 legacy 引擎及其脚本；下文命令和结果仅对应当时版本。当前用法见 [CLI/API 手册](../../sdk/docs/main-cli-zh.md)。

> 历史证据说明：本页的历史实测命令、制品名、路径和来源链接按当时原文保留；正文中的当前接口名称已更新。新的命名与迁移边界见 [ScienceEvolve 改名记录](../renaming/EXECUTION.md)。

> 本文保留历史验收结果，名称已统一为当前 ScienceEvolve 命名；不表示命名调整后重新进行了真实模型验收。

本报告测试的是 `feat/config-workflow-sdk-v0.1.1` 本地工作区（基点 `c70c8a3`，含该工作区当时尚未提交的 SDK/Harness 修改），不是仅对基点提交或已发布 npm 包的验收。测试机为 Windows，已连接创智 VPN。调用了真实模型，可能产生费用。API key 仅从本机已有的 `gateways.json` 读取，不写入脚本、日志或本文；每次运行使用独立临时 SDK 数据目录，正常退出时删除。

## 真实探测矩阵

通过 `sdk/scripts/real-acceptance.mjs`，对 `Qwen3.8-27B` 和 `dsv4-flash-0731` 各执行 2 轮、每轮 4 个 Harness（Codex、pi、dsh、Claude Code）。每个组合实际发送文本普通、文本流式、工具调用普通、工具调用流式 4 类请求，并核对阶段状态与 HTTP 响应。

| 模型 | Codex | pi | dsh | Claude Code |
| --- | --- | --- | --- | --- |
| Qwen3.8-27B | 2/2 通过 | 2/2 通过 | 2/2 通过 | 2/2 通过 |
| dsv4-flash-0731 | 2/2 通过 | 2/2 通过 | 2/2 通过 | 2/2 通过 |

合计 16/16 个组合、64/64 次真实类型请求通过。重复运行中的单次阶段耗时有波动，不能据此保证生产环境永不超时。一次尝试在 Windows 输出管道写入时中断；该批没有计入结果，随后以精简输出完整重跑通过。

## 真实 SDK 工作流

| 模型与工作流 | 结果 | 证据 |
| --- | --- | --- |
| Qwen + Codex Main | 完成 | `agent.completed(main)`、`project.completed`，33 条事件 |
| Qwen + Claude Code worker → Codex Main | 完成 | 两个 Agent 完成、项目完成，56 条事件 |
| dsv4-flash + pi worker → Codex Main | 完成 | 两个 Agent 完成、项目完成，60 条事件 |
| dsv4-flash + dsh worker → Codex Main | 完成 | 两个 Agent 完成、项目完成，92 条事件 |
| dsv4-flash + Codex Main，完成后连续追加 3 次输入 | 首轮及 3 次续写均完成 | 完成代数依次为 0、1、2、3；每次重新进入真实 Harness/模型调用 |
| Qwen + dsh worker，运行中取消 | 取消成功 | 取消前已有 `agent.started` 和代理转发事件；约 5 秒后取消，终态为 `cancelled`，没有伪造完成事件 |

这些是实际启动 CLI 的工作流，不只是四阶段 HTTP 探测；但短验收任务不能替代长课题、复杂多 Agent 调度或跨平台负载测试。

## 已安装 CLI 的真实验收

在同日打包 `@scion-ar/sdk` 0.1.1、于独立 consumer 目录安装并通过生成的 Windows `scion-ar.cmd` 启动后，又对 `dsv4-flash-0731` 做了一次真实 CLI 验收：`gateway add` 成功；`gateway test --harness codex` 的四个阶段全部通过；`run start` 通过实际 Codex CLI 完成研究任务，产生 32 条事件和 1 条 `agent.completed`。命令退出码为 0，最终状态为 `completed`。本次真实测试使用随机临时数据目录，结束后已删除；未把密钥写入仓库或终端输出。安装包自身的确定性 smoke 仍是模拟模型，两者分开记录。

## 发现的未通过项

- Qwen + dsh worker：四阶段网关探测通过，但真实工作流在 35、60、180 秒上限内均未完成。轨迹显示 dsh 已启动、协议代理已转发多次请求并收到部分上游响应，随后仍有请求未结束；目前不能只凭这段轨迹断言是模型、代理还是 dsh 自身的问题。
- Qwen + pi Main：worker 已输出目标文本并完成交接；Main 收到上游响应后又发出请求，120 秒内未完成。dsv4-flash 上相同的 pi worker → Codex Main 工作流成功，因此不能把 Qwen 的表现泛化为 pi 全面不可用。
- 一次 Qwen + pi worker → Codex Main 中，pi worker 完成后 Codex CLI 因测试沙箱用户的 `state_5.sqlite` 迁移冲突退出，项目暂停。这是本机 Codex 状态数据库环境异常；另有 Codex Main 的真实运行成功，不能记作网关失败。
- Kimi-K2.7-Code 的入口在该测试环境可解析到 VPN 地址且 TCP 443 可连接，但 TLS 握手前连接被重置（`ECONNRESET`），所以没有发出模型请求，也未将它计入通过矩阵。Qwen 和 dsv4-flash 入口在同一环境可正常握手并响应。Kimi 的具体服务端原因仍需网络侧核查。

## 复现

在已构建 SDK、已连接 VPN、已有本机网关凭据和四个真实 CLI 的环境中，设置 `SDK_REAL_GATEWAY_FILE`（已有 `gateways.json` 的绝对路径）、`SDK_REAL_MODELS`、`SDK_REAL_HARNESSES`，以及本机 CLI 路径 `SDK_REAL_CODEX_BIN`、`SDK_REAL_DSH_SCRIPT`、`SDK_REAL_CLAUDE_BIN`，然后执行：

```sh
node sdk/scripts/real-acceptance.mjs
```

`SDK_REAL_PROBE_ROUNDS=2` 重复矩阵；`SDK_REAL_MODE=all` 启动真实工作流；`SDK_REAL_CONTINUATION_ROUNDS=3` 在 Codex 工作流完成后连续追加三轮；`SDK_REAL_MODE=cancel` 验证运行中取消。`SDK_REAL_BRIEF=1` 只输出组合结果，避免 Windows 管道承载大量阶段日志。脚本默认删除自己的隔离数据目录，不修改已有网关配置。失败时退出码非零。不要把带凭据的本机网关配置或原始进程轨迹提交到仓库。

模拟单元/集成回归与打包 smoke 的独立结果见 [系统回归测试矩阵](test-matrix-20260923.md)。仍需补充 macOS/Linux、长课题和上面未通过组合的定向诊断；本报告不把未完成项写成通过。
