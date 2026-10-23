# 本地确定性脚本审核

本入口只复核已经通过受控本地导入登记的当前 Script 候选。它不会写稿、批准人审、生成分镜、配音或渲染，也没有 Provider、网络、付费或新增文件产物权限。固定上限为 **0 calls / $0**；执行结果和人工批准是两回事。

## 使用

在 `studio/` 使用仓库锁定的 Node 版本，先只读预览：

```sh
node scripts/local-script-review.mjs --episode EPISODE_ID
```

核对预览的 `episodeId`、`scriptVersion`、`artifactHash`、`snapshotHash`、研究绑定、脚本文件绑定和确定性审核配置。执行时必须逐项提供该预览值，声明实际操作人和原因，并明确确认：

```sh
node scripts/local-script-review.mjs \
  --episode EPISODE_ID \
  --script-version VERSION \
  --artifact-hash ARTIFACT_SHA256 \
  --snapshot SNAPSHOT_SHA256 \
  --actor human:OPERATOR \
  --reason '复核本次确认的脚本版本，保留独立人工批准' \
  --confirm-local-script-review
```

`human:OPERATOR` 是本机操作声明，不是登录会话，也不代表脚本人审已经通过。没有 `--confirm-local-script-review` 的完整请求不会执行。部分执行参数、重复/未知参数和权限覆盖参数均拒绝，不会自动刷新快照再重试。

## 绑定与权限

- 正式状态仍以该期 `episode.json` 为准。已批准脚本、停止/繁忙任务、不完整研究审批、漂移的文件或版本不能复核。
- 快照绑定原始 Episode、当前脚本版本/内容哈希、实际登记脚本及导入清单、研究批准及登记证据、审核配置和实现指纹。预览之后有变化，需要重新预览并明确选择执行。
- CLI 只在当前进程生成随机、最长五分钟的精确请求授权，operation 为 `review:script`，scope 仅为 `state.write`。不接受外部凭据、额外数据根、Provider、审核规则或预算覆盖；授权不会输出或落盘。
- 生产封装使用真实存储、配置和 Workflow Kernel。Kernel 在物理锁内再次核验绑定、有效期及审核前提，拥有持久化操作、CAS、审核结果提交和恢复；不会通过修改 Episode 文件或直调底层审核器跳过它。
- 只接受关闭语义模型审核的确定性配置。该审核证明合同、版本、结构、字数和证据引用等机器规则，不证明所有事实语义正确，也不代替人审。

## 结果与恢复

只有执行结果和重新读取的 Episode 审核记录共同绑定当前版本/哈希，才可报告机器审核完成。`pass` 后仍停在脚本人审；`revise` 或 `escalate` 需要按结果处理，不下调规则或自动继续制作。

遇到过期、漂移、并发或中途错误，命令返回非零状态和安全错误码，不输出任意异常正文或秘密。不能据此推断“零写入”或盲目重放：先只读核对持久化操作与审核记录；确有中断则按现有 Kernel 恢复机制处理，再生成新预览。已提交结果与后续审计告警需分开判断。

停用新 CLI 即可停止这条入口；现有流程与 fixed fallback 保留。本地测试通过不等于 hosted CI、合并、业务验收或发布。

## 合成验证

```sh
node --test tests/local-script-review-cli.test.mjs tests/local-script-review-core.test.mjs
```

测试只使用合成值与临时数据根，覆盖参数闭合、只读预览、精确请求和五分钟授权、零费用与禁止跨用途、读之前授权检查、配置/文件/快照漂移以及生产封装禁止覆盖。真实 Kernel、并发与中断恢复测试另由专项套件负责；完整验证仍执行仓库 `pnpm verify`，不能用这些聚焦测试替代。
