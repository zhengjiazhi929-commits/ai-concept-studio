# 仓库文件分类清单

更新时间：2026-08-25

| 分类 | 范围 | 决定 | 理由 / 后续 |
|---|---|---|---|
| 保留 | `AGENTS.md`、`docs/08-development-governance.md`、`docs/STATUS.md` | 保留 | 执行合同和当前状态真源 |
| 保留 | `studio/src/server/control/`、`security/`、`reviews/` | 保留 | Kernel、权限、预算、人审核心 |
| 保留 | `studio/src/shared/schema.mjs`、`workflow.mjs`、`store.mjs` | 保留 | Episode 合同和 CAS 状态 |
| 保留 | `studio/src/video/`、`renderer.mjs`、`qa.mjs` | 保留 | 当前真实 Remotion 主路径 |
| 保留 | `episodes/golden-001/`、tracked test fixtures | 保留 | 合法固定输入与回归基线 |
| 封装 | `studio/src/server/ai/`、Collector/Research adapters | Provider/数据源边界内封装 | 外部输入与费用风险集中治理 |
| 封装 | `studio/src/shared/cloud-backup.mjs` | 可选能力封装 | OneDrive 不是 M1 硬依赖 |
| 封装 | Kokoro/Python 生成器与本地模型缓存 | 本地工具 Adapter | 不让 Python/模型路径进入领域状态 |
| 重构 | inline Worker prompts | 移入 `studio/prompts/` | 稳定 ID/version/hash 和评测失效 |
| 重构 | 历史脚本中的 Chrome/macOS 绝对命令 | 逐步改成平台 resolver | 不阻断主路径，但不适合开源跨平台 |
| 重构 | 巨型 `orchestrator.mjs` / `app.mjs` | 后续按恢复/审批/上传拆分 | 先用测试保护，不在本轮整体重写 |
| 重构 | README 的历史完成表述 | 以 STATUS 和当前产物校准 | 避免把历史产物当当前证据 |
| 删除候选 | 过时视觉 proof、重复 render/QA 辅助脚本 | M1 后逐个核对再删 | 目前可能仍被文档/证据引用，禁止批量删除 |
| 删除候选 | `handoff/` 旧快照、备份 bundle | 迁移到归档介质后再决定 | 不能替代 STATUS；先确认恢复价值 |
| 永不提交 | `.env*`、本地 key/config、Cookie | 忽略/轮换 | 秘密和账号数据 |
| 永不提交 | `node_modules`、模型缓存、临时目录 | 忽略 | 可重建且体积大 |
| 永不提交 | 普通 live Episode、Provider 状态、日志 | 忽略 | 运行数据、隐私和不稳定证据 |
| 永不提交 | `outputs/`、旁白、MP4、QA 大图 | 外部保存 + manifest | 仓库只保存路径、命令、commit、bytes、SHA-256 |

“删除候选”不是删除授权。任何删除都必须先查引用、确认可恢复并形成独立变更。
