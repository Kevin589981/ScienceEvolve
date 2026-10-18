# 现有 example 迁移到 main（2026-10-06）

下文记录原示例迁移提交的验证范围。随后已合入 CLI/API workspace 与 Git 自动回写，
当前目录语义以 [main CLI](../../sdk/docs/main-cli-zh.md) 和
[Windows workspace 验收](../../sdk/docs/workspace-main-acceptance-20261006-zh.md) 为准；
下表中的“无 --workspace、来源只读”不再适用于显式指定 workspace 的新入口。

2026-10-13 内核同步后，旧 `agents.<name>.proxy` 在规范化时忽略，脚本沿用宿主统一启动环境；下表的 direct 策略是迁移当时的历史行为。当前宿主兼容与来源见 [最新同步记录](../../sdk/docs/main-sync-20261013-zh.md)。

迁移基线：SDK-only `eaeaad1`；固定内核
`764257b3db49ebbcf6b08746278120adbe66a95e+0bd7ab35b2fd864d`。
本次没有修改固定内核、manifest 或方法的原子算法/上游代码。

## 迁移范围与保持的合同

迁移 `example/` 全部 16 个 workflow，另包含 SDK 默认五角色配置与
scienceevolve-sdk Skill 的执行/验收模板。13 个具名科研方法的研究角色、模型、
prompt、Skills、路由、预算、终止规则、会话设置和方法状态机保留。
AHE 的批次循环与可选流程自修改、软件模板的 Testing 自动完成也保留。

这些例子使用 **main 的 Git-off v2**。所有 Agent 共用运行时 cwd，方法自己的
Python 状态、Task Git、候选池、日志与评审交接保持在同一目录。
Git-on 隔离 worktree 会改变文件共享与合并语义，不能通过翻转开关就保持这些方法；
本次不将 Task 内部 Agent 拆成新角色，不给单层方法增加 Evolver。

| 原合同 | main 迁移 |
| --- | --- |
| Agent gatewaySource=profile | 从 workflow 移除，部署使用 gateways + gatewayBindings；API-key 可显式 import 原 profile |
| reasoningEffort=high/xhigh | gatewayReasoningOption=high/xhigh，部署需相应模型映射和精确探测，不静默丢弃 |
| 未写 git | 显式 git.enabled=false，仍由新的 main 调度器和 SQLite 承载 |
| 未写 proxy | 全部显式 direct，继续只影响子 Bash 环境 |
| ARIS Claude Code workspace 权限 | compute，提供方法脚本所需 Bash；Codex 原权限保留 |
| --workspace 原地修改 | 明确绝对 dataDir；在需求声明输入清单，由首个角色在共享 cwd 准备 Task并保存来源摘要 |
| 状态写在用户来源目录 | 在 runtime 工作区持久化，来源只读，恢复不覆盖基线/候选；Task Git 在自己的子目录 |
| 旧目录 resume | 不转换旧 checkpoint；旧运行保持 legacy，新例用独立 main 数据 |

Codex OAuth 的原生路线不要求 API key，但与 gatewayReasoningOption 互斥，
Git-off exec 忽略用户 config 推理偏好。因保留原思考档位，本次模板采用明确的
网关选项；切换 OAuth 需另外选择并记录等能力的模型/推理方案，不能默认宣称与
旧 high/xhigh 等价。Task/ARIS 独立深审工具的原生模型合同没有改写。

## 文档与回归

- 根 README、SDK README、每例启动命令、统一部署说明和 Skill 更新为 main。
- 方法 Skill 补充 cwd、输入准备、恢复与暂存路径规则，原执行协议保留。
- `example-migration.json` 从迁移前版本记录语义哈希；测试核对除明确部署迁移项
  以外的 Agent 配置和完整 orchestration，防止迁移时删阶段、预算或方法指令。
- 科研例加载与 Skill 暂存改用 main 真实实现，不再用 legacy 校验器证明兼容。
- legacy AHE/软件测试使用冻结历史夹具，和当前 example 分开。
- 独立包验证通过默认 main CLI 校验分发模板；保留 legacy 兼容验证。
- POSIX legacy Ctrl+C 提示显式包含 --engine legacy，防止复制恢复命令后误开 main。

## 本地验证

环境：Linux/POSIX，隔离 Node 24.21.0（宿主默认 Node 22 不满足新 SDK 要求）。

- `npm run build`：通过 TypeScript 编译、固定内核 143 文件校验及资源复制。
- `npm test`：605 项通过。包括 18 份配置迁移合同、13 个方法的可搬迁 Skill 暂存、
  实际 main/SQLite 下 AHE 两批共六轮，以及软件 Task 的真实 Node 测试失败、
  安全暂停、重开、保留证据、修复后由 Testing 完成。
- Python 科研协议：`Ran 66 / OK (skipped=1)`；Biomni A1 的检查因此环境缺少
  langgraph 而跳过，没有将其标为执行通过。12 份来源清单的 836 条文件记录均按原 SHA256 检查。
  修正旧测试只接受 9 份清单的假设，并支持 ScientistTwo 的版本化论文/多源码来源。
- DrugEvolve 独立 Python 环境：3 项通过，含真实本机子进程、失败修复与熵中止。
- 独立 tarball 安装/API/CLI：通过，包含默认 main 的分发模板校验、实际 SQLite、
  main MCP/Git/source snapshot 与独立 legacy 兼容验证；POSIX SIGINT/SIGTERM
  暂停后执行打印的原引擎恢复命令均通过。所有模型和 GitHub 调用仍为显式模拟。

模型行为使用显式夹具，外部网关探测以测试接缝模拟；没有调用付费科研模型、
GPU 数据实验、真实 GitHub 建仓或湿实验。本报告证明配置与运行合同的迁移，
不声称完成论文实验或所有 Harness/平台的真实端到端验收。
