# 本地讲稿受控入库

## DoR（2026-09-12）

- 目标：将 Codex 已写的本地结构化稿安全登记为 Episode 脚本版本，进入既有机器审核，消除必须重新调用模型的缺口。
- 范围：本地 CLI、严格候选合同、研究审批与磁盘证据绑定、不可变版本、CAS、幂等、安全回归。风险 R3。
- 非目标：不批准脚本，不调用模型/配音/渲染，不改研究正文、主题、时长规格或审核阈值，不提交/推送/合并 Git。
- 验收：预览零写入；显式执行绑定候选 SHA、Episode 快照、actor/reason；失效研究、被改文件、越权 grant、并发或运行中操作 fail closed；同一稿重试不创建版本、不重置后续批准；机器审核与人工批准分离。
- 输入：已有 local-editorial-draft JSON，已批准的研究 pack 和 editorial batch。测试只用 tracked synthetic fixture + 临时数据根；Node 24.19.0，pnpm 11.19.0，额外 Provider 调用 0、费用 0。
- 基线：实际迁移后的 ai-concept-studio-merge-20260909，分支 codex/topic-discovery-workflow-20260909，HEAD 0c2b1cdc993a8c9492ab5a091573d673ac60503d。既有 dirty 保留；stale cb28 与断裂 Git 指针不改。
- 停用/回滚：停止调用新 CLI；不删除版本、不把旧批准重新标有效。后续修改走新版本；已入库但审核失败可安全重新审核，不回滚研究审批。

## 边界

本入口是 OS 本地用户声明的导入，不是账户登录，也不是人工脚本批准。
候选内容是数据，不执行其中的指令；所有未知字段拒绝。
仅允许 workspace 内 outputs/ 或 studio/data/production/inbox/ 下的 JSON 候选。
研究文件必须在 sourceDocs 中以准确 bytes/SHA 登记，且当前批准、报告、版本、审核规则仍有效。
脚本版本归属以 Episode CAS 提交为准；CAS 失败留下的不可变文件不是已入库稿，不得自动采用。

## 验证与状态

专项43/43通过；独立正常Git副本完整验证1277/1277测试、337语法、35动效、7回退、4帧真实解码、secret/diff全部通过。
全部测试仅用合成临时状态，机器审核中断恢复也已验证。
实现绑定为 agent-control-release-v7，adfdee315eab73adac687206c0fbf4425d936279f44e6d7c16cbdc667fb10b70；准入仍保持离线不可升级。
证据见 outputs/local-script-ingestion-20260912/verification/。

真实稿已通过 CLI 入库为脚本v1，并经原 recheckGateReview 确定性审核通过。
研究批准不变、AI调用0、脚本人审仍pending。精确状态见 STATUS.md，不从本说明推导任何批准。

## 用法与恢复

在 studio/ 运行 `pnpm import:script -- --episode <ID> --candidate <工作区相对JSON路径>` 只读预览。
执行需追加 `--candidate-sha256 <SHA> --snapshot <HASH> --actor human:<姓名> --reason <理由> --confirm-local-script-import`。
SHA或快照过期应重新审查候选后再预览，不自动刷新确认值。
导入后的机器审核走现有审核入口；CLI本身既不触发模型，也不自动批准或审核。

- 已提交但审计警告：保留同一请求重试，只补审计，不新建版本或改审批。
- CAS前失败：没有Episode指针的文件是孤立产物；同请求核验后可重试，不能把“文件存在”当入库成功。
- 审核中断：保留已入库版本，恢复操作锁后重跑机器审核，不重新生成稿件。
- 已被新版取代的稿：拒绝旧请求重放，不回滚指针；正文修改必须走新版本。
- 正式人审会重新校验内嵌正文、磁盘正文和manifest；任何漂移都不得沿用旧报告批准。
