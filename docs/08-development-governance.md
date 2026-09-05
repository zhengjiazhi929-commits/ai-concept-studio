# AI Concept Studio Agent 开发治理规范

状态：生效

版本：2026-08-24

适用范围：仓库内所有 Agent、流水线、审核、视频生产与支撑代码

本文件是项目对 `universal-vibecoding-agent-sop-v2` 的仓库内落地版本，并结合
AI Concept Studio 的 Agent、自动化流水线和存量系统约束。它是自包含规范；外部
SOP 文件只作来源参考，不是运行时依赖。

## 1. 状态真源与责任边界

- 项目当前状态只看 [`STATUS.md`](STATUS.md)。架构文档描述目标和设计，不负责
  声明当前完成度。
- 单期生产状态只看该期 `episode.json`。Markdown、UI、日志和生成文件不能覆盖
  Episode 状态。
- Workflow Kernel 决定状态、权限、预算、并发、恢复和审批有效性。
- Main Agent 只能从 Kernel 给出的合法动作中规划；Model Router 只能从已注册、
  已授权且预算可判定的候选中选择；Review Coordinator 不能替代人工批准。
- 研究、脚本、分镜、素材/声音、最终成片五道人审不可省略或自动推导。

## 2. 工作开始条件（DoR）

每项 R1 以上工作开始前必须明确：

1. 目标用户或系统问题，以及不处理的后果；
2. 范围、非目标和不允许改变的行为；
3. 风险等级：R0 文档、R1 局部、R2 跨模块、R3 安全/费用/发布；
4. 可观察、可复现的验收条件；
5. 输入、Fixture、环境、Provider 与费用边界；
6. 回滚或停用路径；
7. 当前 Git 根、HEAD、分支、worktree 和 dirty 状态。

范围或风险改变时，停止实现并重新确认 DoR。

## 3. 实施规则

- 一个变更集只解决一个可解释目标。不要把运行数据、视觉迭代、架构整改和文档
  清理混为一个提交。
- 先加能够失败的回归测试，再做最小实现；测试必须使用已跟踪的不可变 Fixture
  或临时数据根。
- 不读取或写入 live Episode 来构造测试历史，不把临时目录、个人绝对路径或被
  `.gitignore` 排除的产物当作永久证据。
- 不覆盖人工批准过的产物；新结果创建新版本，并使受影响的下游审批失效。
- 所有状态提交都经过合同、权限、版本、哈希和 CAS 校验。
- 网络、模型、文件写入和付费行为通过统一 Capability 边界。未知价格、未知授权、
  未知调用结算或配置漂移一律暂停。
- 保留 `shadow -> assisted -> active` 的单向分级准入；每次升级都必须绑定当前代码
  与配置的独立评测证据，并支持立即回到 fixed fallback。

## 4. Agent 与评测准入

正式评测记录至少绑定：

- suite ID/version 与用例输入哈希；
- review rubric ID/version；
- Main Agent prompt/schema version；
- Router policy、model registry 与 task profile version；
- 代码 commit 或可验证的 implementation version；
- 实际动作、期望动作、独立判定结果与生成时间。

任何绑定项变化，旧证据自动失效。测试中把 `expectedActionHash` 直接复制为
`actualActionHash` 只能验证存储或聚合逻辑，不能作为正式准入证据。

准入顺序：

1. 固定 Fixture + fake Provider 的确定性验证；
2. 只规划、不执行的 shadow bootstrap；
3. 经明确授权后的限额真实 shadow；
4. 版本绑定评测、成本、安全、恢复和人审指标通过后进入 assisted；
5. active 需要单独人工决定，不能由代码完成或测试通过自动推出。

## 5. 完成条件（DoD）

一项整改只有同时满足下列条件才可标记“技术完成”：

- 目标行为和关键失败路径有回归测试；
- 相关测试、全量测试、格式/diff 检查按风险通过；
- clean clone 或等价隔离环境可复现；
- 没有秘密、live 数据、临时路径或未授权外部调用进入证据；
- 配置、Schema、迁移、恢复、观测和回滚已验证；
- 文档和 `STATUS.md` 与代码一致；
- 未解决风险明确列出，不用“基本通过”掩盖红色门禁。

状态必须分开报告：

| 状态 | 含义 |
|---|---|
| `machine_status` | 自动化检查是否通过 |
| `technical_status` | 代码与技术证据是否完成 |
| `business_acceptance_status` | 用户是否完成业务验收 |
| `release_status` | 是否已合并、部署或正式启用 |

## 6. 最小验证矩阵

| 风险 | 必需验证 |
|---|---|
| R0 | 链接、格式、事实和 `git diff --check` |
| R1 | 聚焦回归测试 + 相关静态检查 |
| R2 | R1 + 全量测试 + clean/临时数据根复现 + 恢复路径 |
| R3 | R2 + 安全边界、费用、并发/崩溃、回滚和人工批准证据 |

任何失败都必须报告真实命令、失败数、首个根因和下一门禁。

CI 与本地门禁必须使用同一证据边界：

- 本地 `diff:check` 至少检查工作树和暂存区；PR 还要检查
  `base...head`，push 还要检查 `before..head`。CI 必须完整 fetch
  所需基线，新分支不得把全零 `before` 当成空 diff 通过。
- render smoke 只能使用内联、确定性的生产语义 `visualPlan` Fixture，
  不读取 live Episode。它必须渲染标题、辅助文案和图形阶段的多个
  代表帧，实际解码 PNG 像素，拒绝全黑、全透明、单色和帧间无变化。
- 本地启动器必须将 `package.json`、`pnpm-lock.yaml`、workspace 配置和
  锁定 Node/pnpm 版本绑定到依赖指纹，同时核对 pnpm 安装 lock 副本和
  直接依赖可解析性；只看 `node_modules` 目录存在不算通过。
- 默认分支每周定时重跑 frozen install、生产依赖安全审计和完整
  verify；工作流文件存在不等于 hosted CI 已经执行。
- 视频 QA 的 Python 运行时必须固定 CPython 小版本，并通过仓库内
  `--require-hashes` 依赖锁固定 NumPy/Pillow；CI 和本地 QA 都要记录
  Python、包版本、脚本与锁文件哈希。不能退回任意系统 `python3`。
- 机器 QA 必须完整解码音视频，并检查轨道数量、帧数、A/V 时长、
  黑帧、冻结和静音覆盖；这些证据仍不能替代最终成片的连续 1x 人工观看。

## 7. Git 与交付

- 开始前核对真实 Git 根和 dirty 状态；有不相关改动时使用独立 worktree。
- 未经明确授权，不 reset、clean、stash、覆盖、commit、push、合并、发布或建 PR。
- 大型或生成媒体保存在外部介质时，仓库内保留相对路径、SHA-256、生成命令、
  Commit 和保留位置组成的可移植 manifest。
- HANDOFF 只保存短的当前快照；历史记录按日期归档。它不能替代 `STATUS.md`。
