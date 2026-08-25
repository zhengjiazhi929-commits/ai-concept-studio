# AI Concept Studio 当前状态

更新时间：2026-08-25 13:00（Asia/Shanghai）

状态真源版本：3

整改分支：`codex/agent-v2-remediation-20260824`

实现验证基线：`38d4206b4f3c0ce514a9fee4de6f62a40eae399f`

## 当前准确结论

安全、恢复、CI、Prompt、评测绑定和文档整改已经完成本地实现；最终冻结代码通过全量
538/538 测试，独立攻击复核没有发现剩余 P0/P1。这个结论只代表整改代码与本地工程证据，
不代表 `golden-001` 已完成业务验收、可进入 `assisted` / `active`、已合并或已发布。

真实 `golden-001` 当前停在 **Research Gate**：研究机器审核已通过，等待 Zhengjiazhi
对当前 v1、内容哈希和机器报告作人工批准或驳回。Script、Storyboard、Assets/Voice、Final
四道后续 Gate 均未批准；没有当前有效旁白、MP4 或 QA 结论。因此“本地离线真实成片”
尚未完成，系统按约定停在第一道人审，而不是绕过人审继续生成。

## 真实业务路径

| Gate / 产物 | 当前状态 | 业务含义 |
|---|---|---|
| Research | 机器 `pass`，人工 `pending`，流程 `waiting_approval` | 现在唯一需要 Zhengjiazhi 决定的 Gate |
| Script | `pending` | Research 批准后才准备当前 36 秒六段脚本审批单 |
| Storyboard | `pending` | Script 批准后才准备当前六镜分镜审批单 |
| Assets / Voice | `pending`；voice=`unconfigured` | 上游三 Gate 批准后才生成本地 Kokoro 候选并等待试听审批 |
| Final | `pending`；render=`stale`，outputPath=`null`；qa=`stale` | 素材/声音 Gate 批准前禁止渲染；当前无有效成片 |

当前 Research 精确绑定：

- artifact version：`1`
- artifact SHA-256：`529027d2fc7abb782a2c7096a72cd02f29cb4bfe583cfbec388c9544aa0b03a9`
- machine report：`review-research-v1-3-2026-08-25T04-58-59-654Z`
- review rules：`review-rubrics-v10 / research-v2`
- 内容：6 项成片结论、12 个一手来源、7 份本地登记证据；当前字节完整性复核通过
- 人工资料包：`outputs/studio/golden-001/upstream-research-gate-dossier-v002.md`
- 资料包 SHA-256：`e094ce0ab5c48fd930eced6ced15ced20ef2f2b24e5ba8b11b98192d20e38952`

`v001` 资料包使用旧 Research Rubric，只保留为历史证据；当前审批只能使用 `v002`。

## 已关闭的整改风险

1. **网络与文件边界**：SSRF、DNS rebinding、redirect SSRF、stream 上限、realpath/symlink、
   静态目录和上传边界均 fail closed。
2. **身份、权限与费用**：localhost 写操作使用短期 operator session + CSRF；网络、模型、
   文件和付费副作用必须经过服务端窄 Capability；Worker 不能自扩权。
3. **中断与恢复**：Provider 结算不明保持冻结并走鉴权人工裁决；上传使用私有 staging、
   marker、锁、CAS 和重启隔离；Importer 审计 outbox 可幂等恢复。
4. **审批完整性**：人工 Gate 绑定版本、内容哈希和当前机器报告；批准前和提交前双重重读；
   Research 来源为空、重复、别名、字段空壳或 claim 引用不闭合时均阻断。
5. **评测与治理**：Prompt、Rubric、Router、模型配置和实现代码进入版本化哈希闭包；
   Ed25519 与 append-only evidence 基础设施已实现，但准入仍保持关闭。
6. **工程门禁**：精确 Node/pnpm、offline frozen install、秘密扫描、依赖审计、语法、全量测试、
   render smoke 和回滚演练已经定义并在本地执行。
7. **文档闭环**：PRD、范围、现状架构、目标架构、差距、威胁、来源、许可证、ADR、回滚、
   文件处置和五 Gate 流程已经补齐；本文件仍是唯一当前状态真源。

## 2026-08-25 最终本地验证

环境：Node `v24.19.0`，pnpm `11.19.0`，Python `3.12.13`（本地 Kokoro 锁定环境）。

| 检查 | 结果 |
|---|---|
| `pnpm install --offline --frozen-lockfile` | 通过，依赖已锁定 |
| tracked + untracked 非忽略文件秘密扫描 | 677 个候选文件，0 命中 |
| `pnpm audit --prod --audit-level high` | 0 个已知漏洞；`nanoid` 仅 3.3.18 |
| `pnpm check` | 178 个 JavaScript / MJS 文件语法通过 |
| `pnpm test` | 538/538 通过，0 失败 |
| Eval / Governance / Research / Golden 专项 | 73/73 通过 |
| `pnpm ci:render-smoke` | 19,776 bytes；externalCalls=0；liveEpisodesRead=0 |
| `pnpm rehearse:rollback` | 7/7 本地 fixture 场景通过；external/paid/live read/write 均为 0 |
| 本地 TTS runtime lock | Python、全部 distribution 与直接模块哈希匹配 |
| Research 当前来源重读 | 7/7 文件 bytes 与 SHA-256 匹配 |
| `git diff --check` | 通过 |
| 已提交归档隔离复现 | 待包含本状态与 Episode 的提交形成后执行并回填 |

评测绑定：

- Review Rubric hash：`338a0d5f69afeb08be7dbcce83aa8bff55f3e8f83d3c1a85d5051b36b5e361c4`
- Implementation hash：`a1c089bb2460e306e78ba777c06573ef5ec68df38b8282e75bd23e14e17ac2b7`
- Suite hash：`80ae67c932dcf12d0ca887f215b05c6542b64ea9ae93951105f363edacbd8fbe`
- Runtime binding hash：`723538c52c25496bf34e6b74ccfc89e4810ac3aec278f258d2767d424e3731c9`
- `runtimeVerified=true`；`admission.eligible=false`；evidence class=`offline-reference-only`

CI 边界：`.github/workflows/verify.yml` 已进入本地分支历史，本地等价门禁通过；分支尚未
push，因此没有 hosted GitHub Actions 运行结果。不能把本地门禁写成“云端 CI 已通过”。

## 仍然存在的门禁与 P2 边界

### 业务 / 发布门禁

1. 依次完成 Research、Script、Storyboard、Assets/Voice、Final 五道人审；当前只到第一道。
2. 素材/声音 Gate 通过后才能生成真实本地 MP4；随后还要媒体 QA、抽帧/转场检查和一次
   不中断 1× 人工观看，最后停在 Final Gate。
3. Kokoro 音色包许可证尚未独立核实；候选只可本地内部评审，不能据此公开或商业发布。
4. 可信 Runner attestation、外部可信 evidence 锚和限额真实 shadow 尚未完成；因此
   `assisted` / `active` 继续硬锁，fixed fallback 保持启用。

### 非阻断 P2 技术债

- pending Importer audit outbox 目前由再次 import 触发恢复，不是启动时主动扫描。
- ffprobe/ffmpeg 有大小、格式、资源和超时限制，但没有 OS 级进程/系统调用沙箱。
- 本地 audit hash-chain 可发现普通篡改，但没有外部可信锚，不能抵御整本账本重写。
- 上传锁在 PID 极端复用时可能保守阻塞，需要操作员检查隔离区。
- Python socket API 拒绝是应用层保护，不是 OS 级断网或全机流量取证。
- hosted GitHub Actions、跨平台 clean clone 和公开发布许可证验收仍待后续授权环境完成。

## Git 与发布状态

- 本地 `main`：`c1cd165fc17a2b5572c52c8ac8b44571436d500f`
- 整改代码提交：`cec7b54`、`f08a786`、`71e3dae`、`9906cde`、`38d4206`
- 当前分支未 push、未创建 PR、未合并 `main`、未部署、未发布、未建立版本标签。
- 本轮只允许在整改分支提交；是否合并 `main` 由 Zhengjiazhi 在后续业务验收后另行决定。

- `machine_status`: local_verification_passed
- `technical_status`: remediation_complete_m1_blocked_at_research_gate
- `business_acceptance_status`: pending_at_research_gate
- `release_status`: committed_on_remediation_branch_not_merged_not_released
