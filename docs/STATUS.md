# AI Concept Studio 当前状态

更新时间：2026-08-24

状态真源版本：2

审计基线：`b29ebe911e2256bdf14fa4fa25aaa04bfeac075c`

整改分支：`codex/agent-v2-remediation-20260824`

## 当前准确结论

本批阻断整改已经完成代码实现，并在当前工作树和移除运行数据后的隔离副本中通过
自动化验证。它证明核心安全边界和测试可复现性有了可审查的实现，不代表整个产品
已经技术完成、通过业务验收、可进入 `assisted` / `active`，也不代表已经合并或发布。

当前真实 `golden-001` 仍处于 `in_production`：素材与最终 Gate 为 `pending`，旁白为
`unconfigured`，渲染和 QA 为 `pending`，没有当前成片输出。因此 M1 真实生产闭环尚未完成。

## 当前运行边界

- 控制模式：只允许 `shadow`；`assisted` 与 `active` 的准备、确认、同模式继续运行均硬锁定。
- 旧状态保护：即使磁盘中已持久化 `assisted` / `active`，也不会继续规划或运行 Worker；
  只允许显式降级到 `shadow`。
- Fixed fallback：保持启用。
- 人工 Gate：研究、脚本、分镜、素材/声音、最终成片五道，全部保留。
- 写操作：localhost 操作员必须先用一次性解锁码换取短期 session，并通过 CSRF 校验。
- 网络、模型、文件写入与付费行为：必须持有服务端签发、限定 Episode / 操作 / scope /
  次数 / 费用 / 有效期的一次性 Capability；缺少授权时 fail closed。
- 外部调用：本轮没有调用真实模型、语音、图片、视频、发布或其他计费 API。

## 2026-08-24 验证结果

验证环境：Node `v24.19.0`，pnpm `11.19.0`（Codex bundled runtime）。

| 项目 | 结果 |
|---|---|
| 关键控制、Fixture、热点与审核链路 | 52/52 通过 |
| `pnpm check` | 通过 |
| `pnpm test` | 439/439 通过 |
| 运行数据隔离副本 | 439/439 通过 |
| `git diff --check` | 通过 |
| Implementation hash | `c88416b9d435501687652a32ea42d12ebac33ef349fdf2119c09f16b6e1d67b4` |
| Suite hash | `7053e9315f67da5b9fbfe6f6559a40d69858b68f0f320226111bc57b480ad7e4` |
| Runtime binding hash | `8f03036d0ba74f48b0bb899780c0b5f2f93af122c2f6fe0ba8479511084583f4` |
| 评测绑定 | `runtimeVerified=true`；91/91 个本地实现路径；6 个固定离线用例 |
| 评测准入 | `eligible=false`；仅为 `offline-reference-only`，不能解锁高权限模式 |
| 真实外部 / Provider 调用 | 0 |

隔离复现从已提交的测试变更 `f08a786` 做 `git archive`，再明确排除了：

- `studio/data/{episodes,collector,research,trends,production,logs,provider-health}`；
- `studio/public/episodes`、`studio/outputs`、仓库根运行期 `episodes` / `research` / `outputs`；
- `.env`、`.env.local` 与本地配置。

依赖目录复用了当前已安装的 `node_modules` 符号链接。因此本结果同时证明测试所需
源码与 Fixture 已进入 Git，并且测试不依赖运行数据；它仍不等价于 clean install、
跨平台或依赖供应链验证。

## 本批已经实现的业务保护

1. **测试不再借用生产历史**：Episode、素材计划、热点信号、审核素材和 Markdown
   脚本均改用已跟踪不可变 Fixture 或逐测试临时数据根。
2. **AI 不能自己证明自己可上线**：固定 Runner 与 Judge 只能产出离线参考证据；在
   缺少可信 attestation 和 append-only 证据存储前，高权限模式不可解锁。
3. **不确定费用不会被当作零费用**：请求发出后如连接中断、超时或响应丢失，预算
   预留会冻结，禁止自动重试或切换 Provider。
4. **Worker 不能给自己扩权**：授权签发能力只在服务端；Worker 和嵌套 Agent 只能
   接收已经收窄的 grant，付费 POST 在发出前逐次消费次数与费用。
5. **人工审批有真实操作员身份**：客户端不能伪造 actor；敏感 API 在认证、CSRF 或
   Capability 缺失时零读取、零写入。
6. **离线语音与测试夹具可复现**：生产 wrapper 与测试 harness 分离，测试不读取 live
   Episode、outputs 或 production 文件。

## 仍未完成的阻断项

### P1：进入真实生产或合并发布前必须处理

1. **M1 真实闭环**：用合法固定输入完成真实本地旁白、真实 Remotion 小样、媒体 QA、
   素材 Gate 和最终 Gate；当前自动化中的 renderer / QA 是 fake，不能冒充成片验收。
2. **可信评测准入**：建立受信 Runner attestation、append-only 证据存储、限额真实
   shadow 和独立语义 / 视觉 Reviewer；完成前维持高权限模式硬锁。
3. **Provider 成功但本地提交不明的恢复**：`provider_result_commit_unknown` 目前会安全
   冻结，但还没有经鉴权的人工裁决 / 恢复 API，只能视为未闭环。
4. **安全第二批**：研究抓取 SSRF 与重定向 SSRF、素材 / 旁白审批 TOCTOU、字段名秘密
   脱敏、审计链读取验证、静态目录 symlink、上传版本竞争仍需修复。
5. **工程门禁**：建立 CI，精确固定 Node / pnpm，加入 frozen install、bundle / render、
   秘密和依赖门禁；处理已知传递依赖 high advisory。
6. **生产提示词与回滚**：为 Script / Storyboard / Asset Worker 提示词建立版本和哈希；
   完成真实回滚演练。当前生产 Capability 只授权一次调用，而 AI 配置允许重试，行为
   偏保守但不一致，需在费用策略中明确。

### P2：SOP 阶段与文档闭环

以下阶段 0 / 治理产物仍缺失，不能用本文件替代：

- `docs/prototype-audit.md`
- `docs/current-architecture.md`
- `docs/gap-analysis.md`
- `docs/m1-roadmap.md`
- `docs/decisions/` 与 Node / Remotion 技术栈 ADR
- `docs/threat-model.md`、`docs/data-sources.md`、`docs/licensing.md`
- 仓库级“保留 / 封装 / 重构 / 删除候选”清单

`docs/04-golden-sample-process.md` 仍写四个审批点，与系统五 Gate 合同不一致，也需要
修订。开源材料、PR 模板和发布标签属于后续发布阶段，不应误报为当前运行 Bug。

## Git 与发布状态

当前整改分支已形成两笔可移植实现提交：

- `cec7b54` — 运行时安全边界；
- `f08a786` — 不可变 Fixture 与运行数据隔离测试。

治理与状态文档单独提交。当前没有 push、没有合并到 `main`、没有部署、没有业务验收。

- `machine_status`: remediation_batch_checks_passed
- `technical_status`: incomplete
- `business_acceptance_status`: pending
- `release_status`: not_released
