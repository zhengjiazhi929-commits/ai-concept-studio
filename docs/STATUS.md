# AI Concept Studio 当前状态

更新时间：2026-08-31 19:27（Asia/Shanghai）

状态真源版本：15

远端 `main` 当前提交：`23990937411710e394cde0be5253b02841d42d11`，来自已合并的
PR #6。对应 hosted `Verify` run `33298465095` 已成功，历史证据为 `749/749`、
273 个源码文件、35/35 动效检查。该证据只说明当时的远端提交通过门禁。

## 当前准确结论

本轮 P1/P2 可靠性优化位于隔离分支 `codex/reliability-p1-p2-20260831`，以当前
`origin/main` 为基线。90 个任务相关路径已选择性提交为
`eea796e25b45f89ce4811d166be41c695fb625c0`，并推送到远端同名分支。没有创建 PR、
没有合并，因此 `main` 仍未改变。

GitHub hosted `Verify` run `33386899516` 已对该代码提交成功完成，耗时 1 分 23 秒。
它完成了跟踪源码 checkout、精确 Node/Python/pnpm 运行时、秘密扫描、锁定依赖安装、
生产依赖审计，以及完整源码、测试、回滚与 Remotion 像素门禁。

最终差异上的本地完整 `CI=true pnpm verify` 已通过：`892/892` 测试、287 个源码文件、
35/35 动效检查、7/7 回滚演练，以及 4 个实际解码且像素哈希互异的 Remotion 代表帧。
另有针对 durable JSON、分段渲染、通用长片 QA、版本化 JSON 锁、Episode 提交、
Research/Trend、审计 outbox、预算恢复和生产入口隔离的跨模块扩大专项测试 `224/224` 通过。
`pnpm audit --prod --audit-level high` 未发现已知漏洞。以上是隔离工作树证据，不等于
远端门禁、完整十分钟渲染、视觉验收或发布。

## 本轮已提交并推送的修复

### P1

1. Main Agent shadow bootstrap 可走真实规划路径，但保持仅规划、无 Worker 派发，并受
   Capability 与预算限制。
2. Worker 结果提交后的审计失败进入可恢复 outbox，不再把成功产物改写成失败。
3. Provider 请求只在进入 dispatching/ambiguous 后冻结；只有显式、自有且证据完整的
   reserved 记录（调用数、费用、预留时间有效，且 dispatchedAt/provider/model/attempt 均明确为空）
   才能在恢复时按零用量释放。缺失、继承、非法或旧版不完整记录全部 fail closed 为
   ambiguous，不会因安全默认值被错当成未派发而释放。
4. 正式 renderer 每次生成新 Remotion bundle，避免复用旧 public 资源；中断遗留的
   `.rendering.mp4` 不再阻塞下一次正确版本分配。
5. Research pack 在规划、导入和状态展示前严格绑定 Episode；证据批次按内容哈希幂等，
   同一 batchId 不同内容返回 409。Episode 已提交后的最新指针或审计失败仅返回 pending，
   不再诱导重复写 Episode。
6. 当前 HEAD 长片候选改用显式版本化 render-job，固定 20×30 秒、`concurrency=1`、
   默认片间暂停 5000ms，并绑定源码、Git 脏内容、Episode、旁白、运行时和浏览器哈希。
   同一 workDirectory 使用跨进程 SQLite 独占锁，所有临时文件按 attempt token 隔离，
   不覆盖旧候选。chunk worker 只写 attempt 临时文件；只有仍持同一 owner lock 的 parent
   能发布稳定 chunk/metadata。真实 `SIGKILL` 回归证明旧 worker 断连退出且 successor 可接管。

### P2

1. Episode JSON 锁使用 owner token、PID/hostname、续租、换主保护和 CAS；rename 已提交后
   的目录 fsync、解锁或 observer 告警不会伪装成回滚，且可由 Episode API 的
   `stateCommit` 查看。等待者在目标版本推进后立即返回明确 conflict；64 路同版本竞争为
   1 次提交、63 次版本冲突、0 次锁超时。首次抢锁在 link 后目录 fsync 失败时仍保留
   完整 owner inode pair 和 heartbeat，并明确返回 warning；换主后旧 owner 不会删除新锁。
2. Trend、Collector、Research 的 JSON 产物改用共享 durable store；多文档 journal 作为
   提交点，拒绝 symlink 路径，并覆盖并发、崩溃和恢复测试。公开写入与恢复入口在任何
   建目录、建锁或 journal 写入前拒绝自有或继承的阶段 hook；生产 Store 不再执行或透传
   调用方回调。真实进程在 journal 持久化后被外部 `SIGKILL` 的回归会完整恢复单 run 多
   pointer 和 256 文档集合，且不遗留进程。
3. 正式 QA 完整解码视频与音频，检查轨道、帧数、A/V 时长、黑帧、冻结和静音；专项 QA
   使用顺序解码的精确帧抽样并记录不可变来源证据。关键静帧按新目录原子发布，禁止同版本
   覆盖。v005 及以后候选通过通用 QA CLI 读取与渲染相同的显式 job，强绑定版本、路径、
   MP4 bytes/SHA-256、源码、Git 工作树和旁白身份；历史 v004 入口继续只用于兼容恢复。
   QA 使用固定 inode/祖先链和 candidate sibling staging，目录换档或 symlink 竞态会在
   根外零写入的情况下 fail closed；validator 与私有发布边界只允许严格的
   `pending_manual_visual_review` 证据进入不可覆盖目录，未验证调用不能直接发布。chunk 与
   最终候选在 link/rename 前后同步文件和目录；post-rename 异常会保留
   `durability_unknown`，只有与 MP4、manifest 和 render-job 精确绑定的正向 durable receipt
   才能进入 QA 或被报告为已发布；其余情况须就地只读确认，不把已发布候选误报为可重跑失败。
   pre-rename 错误继续 fail closed。
4. 中文字体固定为 `@fontsource-variable/noto-sans-sc@5.3.0`，所有 Remotion 入口在字体
   加载完成后继续渲染。
5. CI 的 diff 检查覆盖真实提交范围和未跟踪文件；render smoke 使用内联生产语义计划，
   解码 4 个不同阶段的 PNG 像素；Python QA 固定 CPython 3.12.13、NumPy 2.3.5 和
   Pillow 12.3.0，并使用哈希锁。
6. CI 增加每周运行、完整 Git 历史和生产依赖审计；秘密扫描不再整体跳过含 NUL 的跟踪文件；
   本地启动器绑定 Node、pnpm、manifest、lockfile 和直接依赖状态。
7. 正式 Episode writer、renderer 和 bundle helper 在任何路径读取或 I/O 前拒绝测试专用
   observer/dependency 注入；可替换实现只位于 internal core 和 test harness。评测闭包同时静态绑定
   116 个实现路径与实现哈希 `243d3bdc640ee0ce367d42cf1ba62c52420142cead7b639da5b8004ce01dd64f`，
   新拆分的 core 不会脱离当前评测证据。

## 视频与视觉验收状态

- 本轮没有启动完整 10 分钟渲染，也没有调用付费 Provider 或写入生产 Episode。
- 没有新的完整 MP4、逐段 ffprobe、无损拼接、音频 mux、联系表或连续 1× 人工观看结果。
- 机器测试、静态检查和多帧 smoke 不能替代实际成片视觉检查。
- `voice-v001` 或系统合成旁白仍是临时声音，不是最终真人录音。
- Research v1、Script v1、Storyboard v1 的历史批准不等于 Assets/Voice 或 Final Gate 已批准。

## 仍未解决的外部门禁

GitHub live 设置在本次检查时仍为：`main` 未保护、required checks 为空、rulesets 为 0；
Dependabot security updates、secret scanning 和 push protection 均关闭。仓库内 workflow 已
补门禁与每周审计，本次 push 门禁已实际执行并成功。未经明确授权，本轮没有
修改仓库管理端的保护或安全设置。

## 工作树与交付边界

- 生产 checkout 仍在 `codex/agent-production-pipeline@1bb4859`，保留其既有数据快照、QA
  脚本和全部无关脏文件；本轮未覆盖、清理或提交它们。
- 隔离分支中只有任务相关的代码、测试、CI 和规范被提交。生成物、生产数据快照、
  缓存、媒体和无关文件均未进入提交。
- 代码已满足进入 PR 审阅的本地与 hosted CI 条件，但尚未创建 PR。最终 merge 仍以
  完整十分钟候选、机器 QA、视觉 Skill 检查、连续 1× 人工观看和 Zhengjiazhi 视觉认可全部通过为前提。

- `machine_status`: local_892_of_892_and_hosted_verify_33386899516_passed
- `technical_status`: p1_p2_code_committed_and_pushed_to_review_branch
- `business_acceptance_status`: full_video_and_visual_acceptance_not_run
- `git_status`: commit_and_push_complete_no_pr_no_merge
- `release_status`: not_released
