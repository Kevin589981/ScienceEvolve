# main 内核同步第一阶段验证记录

> 本文为当时版本的验收记录；当前版本已移除 legacy 引擎及相关测试。

此为阶段一历史记录；共用修复及最新结果见 [阶段四记录](main-shared-fixes-test-report-20261005.md)。

日期：2026-10-05。分支：`feat/sdk-main-runtime-sync`。
基线：main `764257b3db49ebbcf6b08746278120adbe66a95e`；SDK `b0a4656`。
环境：Windows、Node 24.20.0、锁定的 npm 依赖。没有调用真实模型或真实 GitHub API，
没有修改本机网关、原项目、main 源码或全局 Git/网络设置。

## 结果

| 检查 | 结果 | 实际覆盖 |
| --- | --- | --- |
| 固定提交校验 | 通过 | 129 个 core 文件、2 个 schema 的原字节；5 组上游测试及 2 个夹具另记来源/转换 hash |
| typecheck / build | 通过 | 全部新旧 SDK 源码，不依赖 main 工作目录 |
| 新内核与宿主专项 | 199 通过、1 跳过 | 实际本地 Git、实际 SQLite、并发事务、epoch、恢复、显式 Git 工具、Git-on 分流、宿主生命周期 |
| 最终全量回归 | 420 通过、23 失败、1 跳过（444 项） | 35 个测试文件；23 项失败全部在旧 SDK 基线中复现 |
| 仓库外 tarball | 通过 | 新入口初始化/停机/重开、SQLite、schema/原生资源、独立 Node 子进程；旧 API/CLI 与两份示例的确定性执行 |

专项中的 1 项跳过是文件符号链接保护用例：当前 Windows 账户创建文件 symlink 返回 EPERM。
目录 junction 和 hardlink 保护已经实际运行，但不能代替文件 symlink 验收。
模拟 Agent/provider 结果只是机制回归，不是推理质量、真实登录或 GitHub 实操验收。

## 测试夹具的平台处理

正式 core 文件没有为 Windows 改写。Git 回归夹具的差异记录在 manifest：

- 只在临时测试仓库关闭 autocrlf，避免宿主 Git 换行偏好影响文件内容断言；
- Windows 目录链接采用 junction，仍验证真实重解析链接的拒绝/隔离行为；
- 文件 symlink 因 EPERM 不可运行时通过 Vitest context 显式标为 skipped；
- Git 用例使用有限 30/60 秒时限，临时目录删除允许短暂重试；
- 工作目录只来自测试的 mkdtemp，没有清理用户仓库或运行数据。

`.gitattributes` 禁止对固定 core、schema 和上游测试做 Git 换行转换，
确保未来 Windows checkout 不会破坏原字节校验。

## 旧基线失败的对照

将 `b0a4656` 导出为独立临时快照，复用相同依赖；运行 6 个相关文件，共 74 项：
51 通过、23 失败。与当前最终全量中的 23 项失败一致，没有把旧失败直接标成新回归，
也没有通过跳过旧测试来制造“全量通过”。

| 类别 | 数量 | 确认的现象 |
| --- | --- | --- |
| network-proxy | 8 | 当前环境 `bash` 无法启动，含 ENOENT；尚未做配有 Bash 的目标平台验收 |
| project-mcp | 7 | 源码模式启动/owner 失败 6 项；README JSON 提取的换行假设失败 1 项 |
| sdk 的 MCP 运行流程 | 2 | 与源码 MCP 启动失败关联；打包后的 JS MCP 流程已通过 |
| shared-workspace | 4 | Windows 绝对路径回传格式断言 1 项；文件 symlink 权限 3 项 |
| project-skills | 1 | 链接创建权限 EPERM |
| shared-contracts | 1 | SHA-256 直接计算 CRLF 字节，与记录的 LF hash 不同；规范化 LF 后匹配 |

MCP 源码宿主使用 `--import <Windows绝对路径>` 加载 tsx。
单独复现该调用得到 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（盘符被视为 URL scheme）。
Node 在该参数中需要 file URL；这个旧源码开发模式问题尚未在本阶段修改正式内核。
README 的 CRLF 规范化后能够提取 JSON 块，因此不能把那项失败解释为示例缺失。

## 尚未验收/实现

公开 createResearchSdk/RunHandle、CLI、旧 WorkflowConfig 与 v3、env/profile，
尤其 Codex OAuth 原生 profile，仍待接通。工作区源码导入与最终交付位置尚未实现。
没有升级旧运行数据，没有默认切换旧引擎，没有发布包或推送分支。
Linux/macOS、完整 Windows 原生 resident、真实模型和真实 GitHub 流程尚未验收。

当前只能确认第一阶段的独立内核宿主可用；不能据此宣称 SDK 全面同步 main。

后续进展：显式 main API、v3 配置与 Git-on 本地端到端检查已在第二阶段加入，
本报告以上结果是第一阶段的历史记录；当前结果见
[第二阶段验证记录](main-sdk-api-test-report-20261005.md)。
