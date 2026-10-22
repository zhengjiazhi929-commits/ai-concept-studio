# 编辑动画零调用衔接

## 开始条件（2026-09-13）

- Zhengjiazhi 同意补齐“已批准分镜的零调用流转”和“新动画素材方案及文件绑定”，再继续素材准备。
- 目标：已批准分镜无需启用模型预算即可完成步骤；素材方案从原批准执行计划确定性派生，并准确绑定本期renderer及实际资源文件。
- 范围R3：受控完成/准备入口、不可变产物、版本与哈希、能力范围、CAS/幂等/审计、素材执行检查点兼容、新资源闭包与合成回归。保留既有旧片路径、shadow与五道人审。
- 非目标：不改已批准研究/脚本/分镜内容，不调用计费或网络服务，不代批素材执行、素材/声音或成片，不生成配音、不正式渲染、不commit/push/merge。
- 验收：默认只读preview；明确请求绑定本期和当前快照；仅state/filesystem能力、0calls/$0；来源/代码/文件变动、旧报告、超范围参数、重复或并发请求均有可验证结果；素材方案等待独立人审，声音明确deferred。写出manifest不等于渲染。
- 输入：原批准分镜仅用于本期合法准备。自动化测试使用合成Fixture及临时数据根，不加载live Episode、个人输出或生产文件作Fixture。
- 验证：专项先RED后GREEN、隔离完整pnpm verify、OCR委托规则复核、代码/资源来源哈希一致。源同步按当前字节基线保护，不覆盖旧dirty。
- 回滚：在分镜/素材准备边界拒绝继续，保留不可变历史及原批准；不得通过回滚JSON伪造批准或释放费用。
- Git基线：实际ai-concept-studio-merge-20260909，HEAD0c2b1cdc993a8c9492ab5a091573d673ac60503d，分支codex/topic-discovery-workflow-20260909；实施于独立普通clone，迁移指针不变。

## 历史验证（不是当前生产状态）

两个零调用入口、实际代码/字体/Logo 文件绑定及人审摘要已实现，按源基线保护同步回实际项目。隔离完整 pnpm verify 1436/1436 通过；本期已合法完成分镜步骤并登记素材方案 v1，stateVersion31→32→33，7 项机器检查通过，停在 waiting_approval。原稿、上游批准和预算未变，0 次计费调用，无正式渲染或 Git 提交。

当前交付状态见 [当前状态](STATUS.md)。单期素材准备方案及历史
`outputs/editorial-assets-20260913/` 证据仅在原本地制作目录保留，不随源码发布，
也不是 clean checkout 测试依赖。本节记录的是当时的方案准备阶段；后续本地素材
物化接口见 [通用物化流程](32-editorial-local-materialization.md)。
本文件不代替人审、素材制作或视觉验收。

## 两个入口与停止位置

从 `studio/` 使用锁定运行时。两个命令只给 `--episode` 时均为只读预览：

```sh
pnpm complete:storyboard --episode <episode-id>
pnpm prepare:editorial-assets --episode <episode-id>
```

- 完成已批分镜：显式请求还需精确 `--artifact-version`、`--artifact-hash`、`--review-report`、`--snapshot`、`--actor human:<operator>`、`--reason`、`--confirm-approved-storyboard-completion`。只有已完成研究/讲稿、当前分镜已批且证据匹配时，才把分镜 ready→complete、相邻素材 pending→ready。
- 准备素材方案：显式请求还需精确 `--snapshot`、`--plan-hash`、`--implementation-hash`、`--actor human:<operator>`、`--reason`、`--confirm-editorial-assets-preparation`。只接受首次素材准备；从原批准逐拍计划派生方案，不接受自由覆盖镜头、预算、provider 或执行器。
- CLI 本地声明不是远程登录，也不是素材或影片的人审批准。未知参数、非本地权限、继承授权、回调或额外权限范围均拒绝。两个入口的身份与实际副作用入口相互隔离。
- 正常结果：素材步骤 blocked、执行检查点 waiting_approval，等待 Zhengjiazhi；机器失败则如实 blocked/needsRevision，不代批、不继续调用 Worker。
- 本轮只绑定来源、代码和资源文件，不执行素材物化；`EditorialMotionPreview` 尚无可调用的素材物化入口，相关调用明确拒绝。审批方案不能绕去旧 `AgentSkillShortExplainer` 执行器。后续物化适配、声音、按真实音频校时、实际画面和成片 QA 仍需分别处理。

## 绑定与恢复

- 分镜来源绑定版本、artifactHash、reviewReportId、正文路径/SHA、manifest 路径/SHA，并继续复核研究和讲稿原件、当前审核配置与逐拍编译结果。
- 方案绑定每镜的时间范围、原文、字幕、对象和事件；代码绑定静态依赖闭包及锁文件；资源绑定动态 Logo 全帧与本地字体 CSS、字体二进制和许可证。哈希登记不代表浏览器字体解析或真实视觉验收已经通过。
- Logo 全帧还须匹配既有批准 manifest 的版本、profile、输出路径和 SHA；不会用任意同尺寸 PNG 冒充原 Logo。代码闭包检查使用本地锁定的 esbuild，只读解析、不产出 bundle；缺编译依赖时明确拒绝准备，不自动安装或联网。
- 方案及 prepare manifest 写入本 Episode 内容寻址目录。提交前重读来源和新产物，最后由现有 Episode writer 做版本比较。跨进程 CAS 冲突可能留下未登记不可变文件，不把文件存在当作提交成功。
- 重试须复用原始完整请求，只对已登记且仍匹配的同一版本补审计，不重建报告、不改旧批准、不重置下游进度。源码、资源、原文、配置或现行候选变化会拒绝沿用旧请求。
- `committed_with_warning` 是已提交但有持久化或审计警告；先查看提交状态，不能重新写 Episode 假装回滚，也不能以新参数自动重做。
