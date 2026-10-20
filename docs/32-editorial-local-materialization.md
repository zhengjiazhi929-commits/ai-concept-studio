# 编辑动画本地素材制作入口

## 开始条件（2026-09-13）

Zhengjiazhi 明确同意素材准备方案 v1，并同意补齐本地素材制作入口，保持零付费、不正式渲染。本轮先通过既有审批入口精确登记 v1 确认，再实现并验证素材文件制作；不能代批资产/声音或最终视觉效果。

- 问题：旧本地动画方法只写清单且固定旧短片；新 editorial 没有实际可执行产物入口，renderer 也未消费已登记包。继续套用会把清单冒充素材，并受后续源码漂移影响。
- 范围 R3：专用零调用 preview/CLI、实际离线动画 bundle、精确 input props、字体/Logo 文件、递归完整性、Kernel/CAS/恢复与校验接入。复制只限批准文件；保留旧流程。
- 非目标：不更改批准研究/讲稿/分镜/素材方案、视觉组件、字体/Logo、package 或 lock；不改变 shadow 和费用权限，不调用外部服务，不生成音频、PNG、MP4，不做正式渲染、视觉代批或 Git 提交。
- 验收：必须产出可执行 JS/CSS、实际字体与原 Logo，不仅是 JSON；输入与批准分镜一致；递归文件集/hash、路径、来源及审批漂移都阻止继续；缺权限、并发、半写入、CAS、审计失败及精确重试有合成测试。已有正式渲染仍受素材/声音 Gate 限制，新无声编辑包不能冒充有声成片。
- 验证环境：独立普通 Git clone、独立锁定依赖副本；测试使用合成 fixture/临时根，不读 live Episode、用户输出或历史素材作 fixture；生产预检与实际操作单独记录。
- 回滚/停用：停止调用专用入口；保留不可变文件和操作收据，不覆盖批准 plan，不手改 Episode、删除历史或伪造回滚。未提交的产物不能视为成功，可用同一完整请求核验恢复。
- 源基线：实际迁移目录 ai-concept-studio-merge-20260909；HEAD 0c2b1cdc993a8c9492ab5a091573d673ac60503d，codex/topic-discovery-workflow-20260909；131项源dirty/704份源文件已隔离保留，5项live/generated变更不复制到测试。

## 方案绑定与后续边界

仅新增服务端路径与直接 Node CLI，避免仅为命令别名改动已批准实现中的 package.json。实际制作状态放独立 production.editorialMaterialization，原方案 materializationStatus 保持原快照。如果确需改变已批准闭包，必须合法新版本/机器重审/再次精确确认，不修改 v1 来假装相同。

本期素材与声音总审、声音接入及真实音频对齐、关键片段和完整 1×视觉验收仍是后续工作。文件可运行、技术测试通过和人工视觉批准应分别记录。

## 使用与验收边界

从 studio 目录直接运行 `node scripts/materialize-editorial-assets.mjs --episode <id>`，默认仅预检。执行请求必须包含预检返回的 snapshot、candidate-hash、machine-review、implementation-hash，以及 human actor、reason 和 `--confirm-editorial-assets-materialization`。入口生成仅本地文件/状态、0 调用/0 美元、有效期 10 分钟的独立能力；不接受 provider、路径或回调覆盖。

输出位于 `studio/public/episodes/<id>/editorial-materialization/<完整请求SHA>/`，包括 bundle、input-props.json、字体/OFL 和 materialization.json。以完整文件集和逐文件字节摘要核验，不以 index.html 或清单单独代表完整素材。仅复制批准源码闭包、字体和 Logo；不复制整个 public 历史目录。

单次 CAS 只登记 24 镜对应素材和独立 receipt，将 assets 完成、voice 就绪；原稿、分镜、素材方案 v1、预算、下游批准保持不变。登记的 verified/visualAcceptance 仍为 false。制作时间轴是 editorial-estimate，audioAligned=false，不是假造音频测量。方案中的 not-started 是编制时快照，当前文件登记另行显示。

精确重试先核验当前批准、完整文件和请求，已提交只补审计；CAS 前崩溃可复用同请求已有完整目录，但绝不覆盖占用目录。若已进入后续音频/验收阶段或更换来源，先核实当前状态，不用旧制作命令重置任务。当前代码不会自动删除中断时的历史文件。

后续素材/声音 Gate 使用递归 bundle 验证；合法 Gate 4 可增添 verified/verifiedAt，但不能改变技术绑定或版权。独立 snapshot 仅复制已验字节及最小 props，清理只作用于自身临时目录。正式 renderer 对本版本无声编辑包明确拒绝；真正旁白与音频对齐接入后需独立验证，不能静默切回当前源码或靠 enforceAudioTrack 伪造成片。

## 当前状态

已实现、审查并保护同步到实际本地项目；本轮冻结完整 pnpm verify 1470/1470 通过，旧源码和预算保持。实际方案批准 state33→34、素材制作 state34→35 均通过既有授权/CAS入口，24 镜素材和345个清单内文件已登记核验；不是仅生成清单，也不是视觉验收。当前 assets complete、voice ready，配音、音频对齐和正式渲染仍未完成。详情和不可变收据见 docs/STATUS.md v54 及 outputs/editorial-materialization-20260913/；上一轮1436项测试只是历史证据。未commit/push/merge。
