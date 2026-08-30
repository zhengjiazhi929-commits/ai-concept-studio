# AI Concept Studio 当前状态

更新时间：2026-08-25 17:03（Asia/Shanghai）

状态真源版本：9

核心整改合并提交：`4408ea52ce8987a6c7a7646c43d2a13179ce07cc`。

首次状态同步合并提交：`59fc520badc82e52a39b58732efe4239aafa363f`。本文件不把自己的
提交 SHA 写成“当前 main”，避免状态提交合并后立即产生自指漂移。

## 当前准确结论

安全、恢复、素材权利、CI 和文档整改已经通过 PR #2 合并到远端 `main`。合并保留了
原有 v004 与动效库，且没有包含 Research、Script 或 Storyboard 的真实业务 Gate 状态变更。

本地离线 `pnpm verify`、分支 push CI、PR merge-ref CI 和合并后的 `main` CI 均已通过；
全量测试为 `597/597`，P0=0、P1=0 的攻击回归仍通过。核心仓库整改已经技术完成并合并，
但这不等于真实业务 Gate 已批准、产品已发布或开源发布材料已经齐备。

## 已合并整改范围

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

- PR #2 未修改 `studio/data/episodes/golden-001/episode.json`。
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
| Hosted push CI | `Verify` run `32829050878` 通过；固定 Actions 已使用 Node 24 runtime |
| PR merge-ref CI | `Verify` run `32829179335` 通过 |
| 核心整改 main CI | `Verify` run `32829318265` 通过；合并提交 `4408ea5` |
| 状态同步 main CI | `Verify` run `32829734090` 通过；合并提交 `59fc520` |
| 技术完成 | 核心仓库整改已完成并合并 |
| 业务验收 | 不在本分支范围；没有新增人工批准 |
| Git 状态 | PR #2 已合并到 `main` |
| 发布 | 代码已合并；产品与开源版本未发布 |

GitHub 当前仍没有分支保护。本次已人工执行“基于最新 `main` → 本地全量验证 → push CI →
PR merge-ref CI → 合并 → main CI”的完整门禁；后续应把已出现的 `Verify` check 配置为
`main` 必需状态检查。

- `machine_status`: local_pr_and_main_hosted_verification_passed
- `technical_status`: core_remediation_merged_to_main
- `business_acceptance_status`: unchanged_out_of_scope
- `release_status`: code_merged_product_and_open_source_not_released
