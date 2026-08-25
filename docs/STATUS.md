# AI Concept Studio 当前状态

更新时间：2026-08-25 16:49（Asia/Shanghai）

状态真源版本：7

整改分支：`codex/agent-v2-core-remediation-20260825`

基线：`origin/main@468e8732d0b26316ef260b538ad17ce95cc6afd0`。

## 当前准确结论

当前分支已经把安全、恢复、素材权利、CI 和文档整改重新落到最新远端 `main` 上。
它保留了主线已经合并的 v004 与动效库，不包含 Research、Script 或 Storyboard 的
真实业务 Gate 状态变更。

重新组装后的代码树 `7da032447098e6d8877ab01eb3e6fb1d6d4ef3ba` 已完成本地离线
`pnpm verify`：`597/597` 测试通过，P0=0、P1=0 的攻击回归仍通过。当前只剩 push、
PR merge-ref hosted CI 和合并后的 `main` CI；在这些结果出现前不宣称已经合并或发布。

## 本分支整改范围

1. 外部素材下载的公网 HTTPS、DNS、重定向、超时和流式大小边界。
2. Provider 调用的 ambiguous 结算冻结、人工对账和禁止静默重试。
3. 预算与计费字段的严格校验，未知费用不再按 0 记账。
4. 外部素材 rights declaration、调用合同、完成收据、资产快照和媒体哈希绑定。
5. 损坏审计账本 fail closed，以及上传提交后的可幂等审计 outbox 恢复。
6. Operator 身份、Capability 与网络、文件、模型和付费副作用边界。
7. 测试 fixture 与 live Episode 隔离，评测证据按实现、配置、输入和运行时失效。
8. 精确 Node/pnpm/依赖版本、秘密扫描、语法检查、测试、回滚和固定渲染 CI。
9. Golden Gate 的通用版本绑定和审核安全逻辑；不包含任何真实人工批准动作。
10. README、治理、威胁模型、许可、回滚和当前状态文档。

## 明确排除

- 不修改 `studio/data/episodes/golden-001/episode.json`。
- 不批准或推进任何真实 Research、Script、Storyboard、Assets/Voice 或 Final Gate。
- 不调用模型、语音、图片、视频、发布或其他付费 Provider。
- 不把业务 Gate 状态提交混入核心整改 PR。
- 不宣称开源发布就绪；LICENSE、SECURITY、CONTRIBUTING 等发布材料仍属后续范围。

## 验证与合并状态

| 层级 | 当前状态 |
|---|---|
| 旧集成快照机器检查 | `571/571` 及离线 `pnpm verify` 通过，仅作历史证据 |
| 最新 main 重组后的聚焦检查 | v004 冲突点与安全/恢复回归 `102/102` 通过 |
| 最新 main 重组后的全量检查 | `597/597`；256 个源码文件；35/35 动效；0 失败 |
| 回滚与固定渲染 | 7/7；19,776 bytes；external/paid/live read/write 均为 0 |
| 技术完成 | 本地完成；待 hosted push CI 与 PR merge-ref CI |
| 业务验收 | 不在本分支范围；没有新增人工批准 |
| Git 状态 | 本地候选已验证，未 push、未建 PR、未合并 |
| 发布 | 未发布 |

GitHub 当前没有分支保护，也没有既有 hosted CI 运行记录。因此本次流程自行执行以下
硬门禁：基于最新 `main` → 本地全量验证 → push → PR merge-ref CI 全绿 → 再合并；
任一环节失败都停在 `main` 合并之前。

- `machine_status`: rebased_candidate_local_verification_passed
- `technical_status`: core_remediation_local_complete_hosted_ci_pending
- `business_acceptance_status`: unchanged_out_of_scope
- `release_status`: local_only_not_pushed_not_merged_not_released
