# 整改 Issue 清单

更新时间：2026-08-25

这是一份本地执行清单，不表示已经在 GitHub 创建 Issue。机器检查、技术完成、业务验收、
合并和发布必须分别判断。

| ID | 目标 | 验收证据 | 当前状态 |
|---|---|---|---|
| R3-SEC-01 | 关闭 SSRF、重定向、流式 OOM、超时和 Provider 结算不明风险 | 攻击回归、独立复核、全量测试 | 本地候选完成；独立复核 P0=0、P1=0 |
| R3-RGT-02 | 让批准声明、调用收据和最终素材权利精确闭环 | 伪 rights/receipt/path/media 回归与 Assets Gate | 本地候选完成；伪造场景 fail closed |
| R3-REC-03 | 闭环审计损坏、上传提交后审计失败和 Provider 恢复 | malformed、outbox、CAS、幂等与对账测试 | 本地候选完成 |
| R3-CAP-04 | 补全网络、付费和文件写入 Capability | 未授权零读取/零写入回归 | 本地候选完成 |
| R3-ROL-05 | 演练紧急降级和失败恢复 | 7 项离线回滚报告 | 7/7 本地 fixture 演练通过 |
| R2-CI-06 | 固定运行时并统一供应链、源码、测试与渲染门禁 | frozen install、check、test、rollback、render smoke | 本地与隔离临时检出均通过；hosted CI 未运行 |
| R2-PRM-07 | Prompt 独立版本化并绑定评测 | Prompt 漂移与 suite hash 测试 | 本地实现与验证完成 |
| R2-EVL-08 | 建立可信证据基础设施 | Ed25519、trusted key、append-only ledger | 已实现；准入仍关闭 |
| R1-DOC-09 | 校准 README、合同、范围和 STATUS | 文档链接、状态语言、diff 检查 | 本地候选完成；隔离复现通过 |
| R2-MRG-10 | 拆分当前历史中的动效库、核心整改、CI/文档和 Gate 状态 | 小型可回滚提交组、清晰 base/head | 未执行；commit/分支整理需要 Zhengjiazhi 独立授权 |
| M1-RES-11 | Research Gate | 当前版本、哈希、机器报告与人审 | Research v1 已批准；本轮冻结不改 |
| M1-SCR-12 | Script Gate | 当前版本、哈希、机器报告与人审 | Script v1 已批准；本轮冻结不改 |
| M1-STO-13 | Storyboard Gate | 当前版本、哈希、机器报告与人审 | 机器通过、人工 pending；本轮明确不推进 |
| M1-VOI-14 | 本地旁白与素材/声音 Gate | 本地候选、manifest、零外部调用、试听人审 | 未开始；本轮不推进 |
| M1-VID-15 | 真实 MP4、QA 与 Final Gate | 可播放 MP4、抽帧、1×观看与精确人审 | 未开始；当前无有效成片 |
| REL-OSS-16 | GitHub v0.1.0 发布准备 | LICENSE、SECURITY、CONTRIBUTING、模板、clean install | 非本轮内部合并范围，不得误报完成 |

本表中的“本地候选完成”不等于已经 commit、push、创建 PR、通过 hosted GitHub Actions、
合并 `main` 或发布。上述动作均需要独立授权。
