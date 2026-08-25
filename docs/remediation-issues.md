# 整改 Issue 清单

更新时间：2026-08-25

这是一份本地执行清单，不表示已经在 GitHub 创建 Issue。

| ID | 目标 | 验收证据 | 当前状态 |
|---|---|---|---|
| R3-SEC-01 | 关闭 SSRF、静态路径、秘密字段和审计篡改风险 | 攻击型回归、全量测试 | 本地实现与验证完成 |
| R3-REC-02 | 闭环 Provider 提交不明、TOCTOU、上传事务 | 鉴权裁决、竞争/漂移/幂等测试 | 本地实现与验证完成 |
| R3-ROL-03 | 演练紧急降级和失败恢复 | 7 项离线回滚报告 | 7/7 本地 fixture 演练通过 |
| R2-CI-04 | 固定运行时和供应链/渲染门禁 | frozen install、audit、check、test、render smoke | 本地等价门禁通过；hosted CI 尚未运行 |
| R2-PRM-05 | Prompt 独立版本化并绑定评测 | Prompt 漂移与 suite hash 测试 | 本地实现与验证完成 |
| R2-EVL-06 | 建立可信证据基础设施 | Ed25519、trusted key、append-only ledger | 已实现；准入仍关闭 |
| R1-DOC-07 | 补齐 SOP 阶段 0～3 文档并校准 README/STATUS | 文档清单、链接、diff 检查 | 已补齐，等待本分支最终提交 |
| M1-RES-08 | 刷新当前研究 Gate | 固定来源、claim 台账、v1、当前哈希、机器报告和人审 | 机器报告通过，等待 Zhengjiazhi 确认 |
| M1-SCR-09 | 刷新当前短脚本 Gate | 36 秒六段、claim 映射、v1、当前哈希、机器报告和人审 | 被研究 Gate 阻断 |
| M1-STO-10 | 刷新当前分镜 Gate | 36 秒六镜、逻辑证据、v1、当前哈希、机器报告和人审 | 被脚本 Gate 阻断 |
| M1-VOI-11 | 生成本地旁白候选 | 36 秒 WAV、manifest、配置调用数 0 | 被研究/脚本/分镜 Gate 阻断；旧 v001 已作废 |
| M1-GAT-12 | 完成素材/声音 Gate | 当前文件、版本、哈希、机器报告和人审 | 尚未开始 |
| M1-VID-13 | 生成真实 MP4 并完成 QA | 可播放 MP4、QA、抽帧、1×观看 | 被上游人工 Gate 阻断 |
| M1-GAT-14 | 完成最终成片 Gate | 当前 MP4/QA 精确人审 | 尚未开始 |
| REL-OSS-15 | GitHub v0.1.0 发布准备 | LICENSE、SECURITY、CONTRIBUTING、模板、clean install | 非本轮，不得误报 |

本表的“本地通过”来自当前分支的本地等价命令，不是 hosted GitHub Actions 结果。创建
GitHub Issue、PR、push、合并或发布仍需要独立授权。
