# 原生 OAuth / Git-on Evolver / 默认入口验收（2026-10-05）

> 本文为当时版本的验收记录；当前版本已移除 legacy 引擎及相关测试。

> 历史证据说明：本页的历史实测命令、制品名、路径和来源链接按当时原文保留；正文中的当前接口名称已更新。新的命名与迁移边界见 [ScienceEvolve 命名迁移](naming-migration.md)。

验收时使用开发分支 `feat/sdk-main-runtime-sync`，包版本 0.1.1、private；验收过程中未提交/推送 SDK 或 main 代码。
交付补充：SDK 源码和文档现已快进合入原有分支 [feat/sdk-only-v0.1.1](https://github.com/fnlp-agentRL/SCION-AR/tree/feat/sdk-only-v0.1.1)，
没有创建 SDK PR 或合并 main。本地 main 的共用源码修复仍未提交或推送。下文保留原始验收结果与失败记录。
来源 main `764257b3db49ebbcf6b08746278120adbe66a95e`，当前 runtimeRevision
`764257b3db49ebbcf6b08746278120adbe66a95e+0bd7ab35b2fd864d`，143 项来源文件/schema/原生资源。
共用修复同时登记并修改本地 main；可反向还原来源 SHA-256，没有手改 SDK core 副本。

## 实现与边界

- 根 SDK/CLI 默认切换为 main；`/main`、`--engine main` 为别名，旧实现为 `/legacy`、`--engine legacy`。
- 原生 Codex 路由使用部署的目录别名，认证由 Codex 管理，不提取/复制 OAuth token、不伪造 API-key 网关。
  普通 exec 使用官方 provider 并隔离用户配置；常驻 app-server 显式设置官方 provider、权限与 MCP，但仍读取可信原生配置偏好。
- 注册别名在独立 dataDir 中锁定。portable workflow 不接收 profile 路径/别名；其他 Harness 和混合 reasoning 路线拒绝此能力。
- 动态 control MCP、resident proxy、descriptor MCP、Pi extension 进入依赖闭包及独立安装包检查。
- OAuth `account/updated` 和 `skills/changed` 通知按精确字段验证；注入业务字段仍拒绝。
- 工作流事实使用独立只读 rootId，不放开 junction/symlink 遍历，也不赋予 Leader 业务写/Git 权限。
- 普通入口提供 scion_read_invocation_input：只能分块读取本轮 Inbox/Memory，不接收路径、
  拒绝 junction/symlink、hard link、越界和非法 UTF-8 offset。没有为读取输入放开 shell。
- 控制连接重置不会崩溃宿主；已发出的操作继续 drain，断开不代表 GitHub 操作失败，不自动重放操作。
- 最终交付补充调用需当前 writer 的精确 reservation、同 canonical owner、同 epoch 和前一原生 Stop 证明；不放宽 ownership fence。

## 真实调用

环境为 Windows、Node 24.20.0、Codex CLI 0.152.0，模型 `gpt-6.1-sol`，官方原生 OAuth。
真实调用从构建后的 SDK dist 发起，不是 fake model/provider；仓库外安装包烟测另列。
用户授权了专用私有 GitHub 仓库/分支/PR。GitHub 凭据从已登录 gh 在内存解析，未输出或保存 token。
本节省略本机用户名、登录目录、密钥和原始控制 capability；原始记录保留本机，不随包提交。

普通入口 run `prj_0ef00f53cc5c489a8a41d89829dc211b` 已完成：真实模型回复 sentinel，
官方 complete_project/finish_task 正式提交，课题完成。原生 config.toml 字节未改变。

Git-on e 轮（revision 后缀 `+0c089e484f02b240`）run `prj_49fa06a3a5114aec9dd3fc26f7fbe64e`，
专用私有仓库 [scion-sdk-acceptance-20261005-muv1hs8w](https://github.com/chraodo/scion-sdk-acceptance-20261005-muv1hs8w)。
状态：Windows 上本轮有界真实端到端验收通过。workflowRevision 从 1 变为 2，
正式配置事件 seq 54 记录 Main/执行 Agent 的 prompt 修改，原始配置不含追加后缀。
设计为 Leader/Main、execution、review 三 Agent：正式 prompt 自修改一次 → 实现 → 独立审计 →
成员 PR 合并 → canonical 组 PR 合入 main → 正式完成 → 导出集成 commit → 宿主真实 Python unittest → 重开检查不重跑。
原生非 yolo 的 shell 被禁止；审计 Agent 执行静态审计，不伪称跑过测试。Python 测试由宿主在最终导出上真实执行。

两个成员 PR 和最终组 PR 均真实合并；最终 main commit 为
`3db9097431819a1f88313bdd352496cb70461264`。导出 6 个文件、2623 字节，所需四个交付文件齐全，
acceptance.md 包含进化后的 marker。宿主 `python -m unittest -v` 实际运行 3 项测试、全部通过。
原生 config.toml 字节未改变。关闭并重开两次后仍为 completed、eventSeq 434，未重新发起模型业务。

首轮验收脚本误读取公开 snapshot 中不存在的 agents 字段，业务实际已完成，但脚本退出失败。
已修正脚本：使用正式持久化配置事件与当前 workflowRevision 验证精确追加后缀，
不扩展公开快照或读取认证数据。原 failure.json 保留；同 revision 重开、重新导出到新目录并完成上述核验。

最新 revision 的仓库外安装包普通 OAuth 已通过：run `prj_685e9aaf22bf43f98de3f505fa7cd333`，
实际使用根入口 createResearchSdk。模型读取 Inbox 的两块及 Memory，返回 sentinel，正式提交
complete_project/finish_task；课题 completed、原生 config 字节未变。

最新安装包的 Git-on f 轮 run `prj_a0721e1ab6824af884431481c5d28c03`，
仓库 [scion-sdk-acceptance-20261005-muv2q4i3](https://github.com/chraodo/scion-sdk-acceptance-20261005-muv2q4i3)。
状态：全部通过，使用安装后的根默认 API，不是源码 dist。09:55:11–10:07:15 UTC
完成有界任务；正式 prompt 配置事件 seq 55、workflowRevision 2，两个精确追加后缀均已验证。
三个 PR 均合并，最终 main commit `6d817d8f18ad69e8a6babb7e50f2e77c53523b2e`。
最终导出 6 个文件、3440 字节，四个要求的文件及 marker 齐全。宿主实际运行 3 项 Python unittest、全部通过。
课题和组均 completed，三项 PR 事实均 merged；关闭并重开后 eventSeq 保持 430、状态保持 completed，
没有重跑业务。整个测试前后原生 config.toml 字节相同。

安装包与源码构建的默认入口、公开 client、profile 注册、控制 MCP、主运行 facade、
最终集成和状态库关键模块的 SHA-256 相同，manifest/runtimeRevision 相同。
安装时没有启动 Web/HTTP 服务。安装后 Codex 普通与常驻两条真实路径均已验证。

## 排障记录（保留失败，不计为通过）

| 尝试 | 事实与处理 |
| --- | --- |
| OAuth a/b | 动态 control-mcp 入口未打包；补齐显式闭包 |
| OAuth c | 宿主旧配置有弃用字段；普通 exec 保持隔离，常驻 native 不使用不兼容 strict-config；未修改宿主配置 |
| OAuth d | 真实普通入口完成 |
| Git a | resident-control-proxy 动态入口缺失；补齐闭包 |
| Git b | account/updated 被误拒绝；只接纳验证过的账号状态通知 |
| Git c | skills/changed 被误拒绝；只接纳空失效通知。验收配置未授权组 Leader 编辑，另外修正验收配置，不改原 example |
| Git d | prompt 修改、两个成员 PR、最终 PR 已真实合并；控制 socket ECONNRESET 崩溃。原 revision 恢复又暴露最终补充调用缺少同 epoch Stop 续接证明；已修复，但旧现场未升级、不计完成 |
| Git e | 使用包含修复的新 revision、新独立目录；业务完成，修正验收脚本字段后完成导出、真实测试及重开检查 |
| 安装包普通 a/b | workspace 策略禁 shell，但原工具只有已发布成果读取，无法读取强制要求的 Inbox/Memory；正式停在用户介入，不计通过。补齐精确只读输入工具，c 轮真实通过 |
| Git f | 使用包含输入读取修复的最新安装包、独立数据目录；不升级 e 轮旧数据；结果见上节 |

共创建六个专用私有测试仓库。未删除原始失败现场或仓库，未改写旧运行数据的 revision 标记。
旧 d 轮的遗留锁在确认宿主与测试子进程均停止后移为备份，恢复严格使用原 revision；没有抢占活动锁。
运行数据不支持跨 revision 自动升级，这是明确限制，不通过手工改 marker 绕过。

## 本地验证

- SDK 与共用 main 服务端 typecheck 均通过；构建/来源反向一致性校验通过。
- 最终全量 Vitest（52 文件、585 项）：580 通过、4 个旧 Windows 文件 symlink 夹具 EPERM 失败、1 权限跳过。
  之前相关 7 文件 36 项全部通过，新增输入读取 4 项全部通过。不禁用安全断言，也不把权限失败计为通过。
- 实际 loopback 测试覆盖 reset、过长请求及断线后的在途操作 drain；不是只有源码文本断言。
- 仓库外 tarball API/CLI 烟测通过：默认 main、显式 legacy、SQLite、编译 MCP、动态资源、本地 Git 导入/导出。
  这些烟测的模型/provider 为模拟，不能当作真实 GitHub/模型证据。首次 prepack 的本机 Git ownership 环境拒绝，
  仅为该测试进程设置 exact safe.directory 后复测通过，未修改全局 Git 配置。
- 已清理旧 CLI 断言产生的 unused.json；原 example JSON 未改写，网关配置与本机原生配置未修改。

## 未覆盖

非 yolo Git-on 文件 broker 当前仅支持 Windows/Linux，macOS 会 fail closed。未完成 Linux/macOS、
四 Harness 真实模型矩阵。安装后的 Codex 普通 OAuth 及 Git-on 有界任务已真实验证。
原生 OAuth 没有网关同等的逐请求 Token 账本；
不能以零/缺失统计宣称免费。需要遗留 workspace 原地执行的用户必须显式选择 legacy。
一轮有界任务通过不等于所有配置组合、故障恢复或生产环境全面验收。
