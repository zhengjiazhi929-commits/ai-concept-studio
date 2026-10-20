# 已批准脚本零调用流转与本地分镜受控入库

## DoR · 2026-09-13

- 用户授权：Zhengjiazhi 对“补齐已批讲稿零调用流转和本地分镜入库、专项测试后送机器审核”回复“可以”。不包含分镜人工批准、付费调用、正式渲染或 Git 发布。
- 目标：已批准本地脚本无需模型预算即可经 Kernel 完成本阶段；本地分镜原样登记为可追溯的编辑产物，进入既有机器审核，不伪造模型生成或已实现画面。
- 范围：两个独立本地 CLI、严格请求/候选合同、零调用实际 sink、上游精确批准/磁盘证据绑定、不可变版本/CAS/幂等/审计、分镜内嵌内容完整性及人审内容可见性。R3 费用/授权边界与跨模块状态。
- 非目标：不扩大通用 runAgent 权限，不关闭预算或人审；不改已批准脚本、主题、自然语速、长片规格或旧 timed 审核阈值；不改渲染器/卡片材质，不生成素材、音频或视频，不提交推送合并。
- 本期缺少绝对时码和多拍可执行计划。入口明确登记 editorial-cue-plan，不硬编12秒镜头或480秒配音、不把新微磨砂/多拍插画套成旧单图resolver。入库不是审核通过；既有正式分镜Gate继续拒绝缺失时间轴/执行计划的编辑稿，并清楚列出待完成项。
- 验收：默认预览零写入；显式确认绑定 actor/reason、Episode及候选完整快照；只有当前研究与脚本均有效批准且实际文件完整时可操作；零grant不能跨sink/model；未知字段/getter/继承授权/符号链接/超限文件/内容改写/cue倒序/来源断裂拒绝。CAS/审计失败如实区分；幂等不重复版本、不重置已有效下游；旧版本与产物保留。
- 已批脚本完成只允许script ready→complete、相邻storyboard pending→ready；不修改审批、原稿、预算、AI统计或下游已有进展。入口本身不调用模型注册器。
- 分镜导入后script仍approved，storyboard待审；完整原文与sourceUnits按序唯一覆盖、cue顺序和claim闭合；编辑稿未实现与未配音状态不可被当成ready。正式机器审核若报告待修改，按真实结果交付，不放宽阈值绿灯。
- 输入/测试：仅当前批准稿作为操作输入；测试在临时根用tracked synthetic骨架重建研究/脚本/分镜，绝不从live Episode/outputs复制夹具。Node24.19.0、pnpm11.19.0；Provider调用0、费用0。
- 验证：先RED再GREEN、专项与静态、完整隔离verify、只读OCR规则审查、恢复/并发/权限回归；实现配置指纹变化使旧准入失效。机器检查、技术完成、人工接受、Git发布分别记录。
- 隔离方式：正常独立 Git 副本、无硬链接。源根 ai-concept-studio-merge-20260909，HEAD0c2b1cdc993a8c9492ab5a091573d673ac60503d，分支codex/topic-discovery-workflow-20260909；旧 dirty 保留，源 Git 指针不 repair。源基线绑定641份代码/配置/docs/测试；只回同步本轮差异且先核对基线 SHA。最终冻结 manifest 与校验日志保留在下述项目相对证据目录，不依赖临时目录存在。
- 停用/回退：停止两个新CLI，旧生产入口不变。保留已经提交的不可变版本与审计，不自动恢复旧批准；仅文件落地而CAS失败不等于已登记，不自动采用。无权直接撤销用户的脚本批准。

## 当前进度

两个入口和编辑稿审核展示已实现，完整隔离 `pnpm verify` 通过：1326/1326 测试、348 语法、35 动效、7 回退、4 帧固定合成渲染与像素检查、secret/diff 均通过；49 项为本轮新增回归。冻结代码已同步源项目，旧改动保留。

Open Code Review delegation 完整规则审查本轮30项可审文件 delta，另40项旧 dirty 有明确跳过理由；补充审阅本说明。两条旧专项 usage 断言签名假阳性已修正并在冻结版本实跑通过。证据位于 `outputs/local-storyboard-ingestion-20260913/verification/final-01/`，日志 SHA `94a91881e27f342a72422b58a272fd42121772d27417a0736a012d7958fc1e7c`。

生产操作已通过两个 CLI 完成，实际研究/脚本批准与正文保持不变。24镜/46单元分镜v1已登记；既有 `recheckGateReview` 返回 `revise`，11个阻断项（10种code），人审不可批准。缺少时间轴和可执行图形计划是真实待办，不放宽 timed 检查。操作收据见同批 `operation-v1/`，精确状态见 [STATUS.md](STATUS.md)。实现版v8，admission保持false；未提交、推送、合并或调用付费服务。

## 使用与恢复

在 `studio/` 运行：

- `pnpm complete:script -- --episode <ID>`：只读核验当前批准讲稿。执行还需 `--artifact-version <V> --artifact-hash <HASH> --review-report <ID> --snapshot <HASH> --actor human:<姓名> --reason <理由> --confirm-approved-script-completion`。
- `pnpm import:storyboard -- --episode <ID> --candidate <工作区相对JSON路径>`：只读核验编辑稿。执行还需 `--candidate-sha256 <SHA> --snapshot <HASH> --actor human:<姓名> --reason <理由> --confirm-local-storyboard-import`。

预览不会签发 grant 或写入状态。执行授权为每个请求独立的 OS 本地声明，只有状态/文件写入，0 次调用、0 美元；既不是账户登录，也不是人审批准。过期快照须先重新检查内容，不自动刷新确认值。

通用候选格式 `codex-authored-storyboard-candidate-v1` 绑定当前已批准本地讲稿及其 manifest，完整编辑正文置于 `content`。只接受原文单元按序完整覆盖、原文 SHA 一致、证据引用闭合、触发短语按口播顺序出现、时码明确为未测量。文件仍只是数据，不执行 action/implementation 中的文字。

新版本将旧场景、字幕和时长保存在不可变 import manifest；当前时间轴清空，不混用旧版画面。新分镜使下游审批失效，研究和讲稿批准保持不变。当前版本同请求重试只修复审计，不重复登记或清空机器报告；旧版被取代后禁止回放。

CAS 前失败留下的孤立文件不等于入库。已提交但审计失败返回明确警告，使用原请求重试。停用入口即可停止新导入，不删除证据或恢复旧批准。后续实现动画/时间轴必须登记新版本，再进入原有审核，不直接修改已登记正文。
