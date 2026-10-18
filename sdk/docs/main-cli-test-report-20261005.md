# main CLI 迁移验证记录（2026-10-05）

> 本文为当时版本的验收记录；当前版本已移除 legacy 引擎及相关测试。

> 历史证据说明：本页的历史实测命令、制品名、路径和来源链接按当时原文保留；正文中的当前接口名称已更新。新的命名与迁移边界见 [ScienceEvolve 命名迁移](naming-migration.md)。

此为阶段三历史记录；授权/MCP 修复、workspace 导出及最新结果见 [阶段四记录](main-shared-fixes-test-report-20261005.md)。

阶段三；开发分支 `feat/sdk-main-runtime-sync`，SDK 基线 `b0a4656`，
固定 main 来源 `764257b3db49ebbcf6b08746278120adbe66a95e`。包仍为私有开发版 0.1.1。
本轮没有提交、推送、发布、修改 main 或用户业务/网关配置；原有 example JSON 未改写。

## 本轮实现

- CLI 显式 `--engine main` 接通 `@scion-ar/sdk/main`，不改变旧默认引擎。
- 单独 main CLI transport：workflow 校验、Harness catalog、网关保存/阶段探测、部署绑定、
  启动与事件、快照、输入/响应、暂停/恢复、Git 初始化重试、可恢复 Stop。
- main 数据目录必须绝对且显式，不采用旧 CLI 环境/default 根目录。
- runtime JSON 仅允许部署字段与 Git tokenEnv 引用；路径相对配置文件解析。
  公开 SDK options 同样使用严格白名单，不允许嵌入 runner、adapter、control bridge 或 raw credential。
- execution 支持部分选项；数值不强转，检查正整数、timer 上限和有效 retryBase/retryMax。
- Git-on Stop 使用内核 paused / collaboration:user-cancelled；Git-off cancel 保持终态。
  事件 sourceType/seq/epoch 不重命名，完成状态读实际 wait/snapshot。
- 信号在宿主创建前登记；启动/恢复期间锁存停止意图，安全打开后关闭或在 RunHandle 可用后 Stop。
  不重复 Stop/强杀，不在关闭失败时打印假成功的恢复命令；恢复命令带原引擎、目录和部署文件。
- 新增中文 CLI 使用说明及仓库外 CLI 消费夹具；没有改写原 SDK-only examples。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| TypeScript typecheck | 通过 |
| build（tarball prepack 实际执行） | 通过 |
| main 来源/资源校验 | 138 个 manifest 条目通过；正式 core 字节未改变 |
| 6 个专项测试文件 | 68 通过；其中本轮新增 options 21、CLI 16，共 37 项 |
| 全量 npm test | 479 通过、23 失败、1 权限跳过，共 503 项 / 40 文件（34 文件通过、6 文件失败） |
| npm run smoke:package | 通过；新 API/内部宿主/新 CLI、旧 API/CLI/profile/env/网关四阶段/AHE/软件开发示例 |
| git diff --check | 通过（当前 autocrlf 提示不代表内容错误） |

23 项全量失败仍为第一阶段在原 SDK `b0a4656` 独立基线中复现的集合：
Windows Bash 缺失、源码 MCP loader 未使用 file URL、CRLF 文档/源指纹、Windows 路径期望及
symlink 权限。没有新增失败，也没有跳过这些旧失败来制造全绿。
跳过项仍为 main Git 本地防护测试中的文件 symlink 权限检查。
完整分类见 [第一阶段记录](main-runtime-test-report-20261005.md)。

## 真实执行与模拟边界

- options 测试验证实际 schema、路径解析、懒读取/轮换及 abort；无模型或 GitHub 请求。
- CLI Git-off 集成使用真实 main Orchestrator、SQLite、GatewayStore、事件/数据目录与重开；
  Agent 返回使用明确的模拟 ControlAction，不是模型真实完成。
- CLI Git-on Stop、重复信号、启动信号、Stop 失败、重试和探测取消测试是模拟 RunHandle transport
  合约；没有把它们描述为原生 Harness/GitHub 验收。
- 前阶段实际 SQLite/本地 Git、正式 resident launcher + 模拟 provider/native 的 Git-on 测试继续通过。
- 仓库外 tarball 的新 CLI 在多个独立 Node 子进程中运行：实际宿主/SQLite、v3 离线校验、
  网关保存/脱敏、Pi 发现、目录锁释放、旧 default 不变、拒绝 workspace 和混用数据目录。
  没有发出探测/模型或 GitHub 请求。
- 原包级模拟模型兼容测试继续执行原 profile/env、CLI、AHE 与软件开发示例；原始 JSON 未修改。

本轮包和外部消费者保留于系统临时目录 `scion-ar-sdk-consumer-FkMndt`；
不是用户业务目录，测试 credential 全部为 fixture。构建仅使用当前子进程的 safe.directory，
没有更改用户全局 Git 信任设置。main HEAD 未变，已有 `server/temp/` 未处理。

## 未完成 / 已知问题

默认 root API/CLI 仍是旧引擎，新入口尚不支持原生 profile/OAuth、`--workspace` 源码导入/交付、
原 SDK-only Loop/Evolver 的完整调度语义适配，也没有旧数据自动转换或跨进程控制服务。
原有 example JSON 不作为此次迁移改写目标。
初始化期间信号等待当前初始化安全收尾，不提供未经内核支持的硬中止或虚假暂停 checkpoint。

固定 main 的 Git 授权错误 checkpoint 缺陷未修复；阶段二记录及复现断言仍保留，
不是“授权失败已经正常恢复”。见 [第二阶段记录](main-sdk-api-test-report-20261005.md)。
多 Agent 真实模型、真实 GitHub 写入、多账户跨重开绑定及完整 Windows/Linux/macOS 验收未完成。
目前不能宣称 SDK 与最新 main 全面等价或生产验收已通过。
