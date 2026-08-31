# AI Concept Studio 当前状态

更新时间：2026-08-31 21:15（Asia/Shanghai）

状态真源版本：18

远端 `main` 当前提交：`23990937411710e394cde0be5253b02841d42d11`，来自已合并的
PR #6。对应 hosted `Verify` run `33298465095` 已成功，历史证据为 `749/749`、
273 个源码文件、35/35 动效检查。该证据只说明当时的远端提交通过门禁。

## 当前准确结论

本轮 P1/P2 可靠性优化位于隔离分支 `codex/reliability-p1-p2-20260831`，以当前
`origin/main` 为基线。90 个任务相关路径已从 `eea796e25b45f89ce4811d166be41c695fb625c0`
起选择性提交并推送到远端同名分支；随后又提交了 render-job、状态证据和显式 Remotion
超时修复。PR #7 已创建且保持 OPEN，没有自动合并请求，也没有合并，因此 `main` 仍未改变。

显式 Remotion 超时提交 `837342a7c9e76245d5f7b5aa12cccf84207ec870` 的 GitHub hosted
push `Verify` run `33392665301` 和 PR merge-ref `Verify` run `33392669795` 均已成功。
它们完成了跟踪源码 checkout、精确 Node/Python/pnpm 运行时、秘密扫描、锁定依赖安装、
生产依赖审计，以及完整源码、测试、回滚与 Remotion 像素门禁。这些 run 只证明
`837342a`；字体内联修复提交后形成的新 HEAD 仍必须通过新的 hosted `Verify` 才可启动 v010。

首次使用显式 job `a3d8b4b` / `full-video-current-visual-upgrade-v008` 启动时，
chunk 0 在发布任何 part、稳定 chunk 或最终目录前因 Remotion 默认 30000ms 浏览器初始化预算
退出。同环境只读计时在约 91.8 秒后成功载入相同 Composition，证明是启动预算缺口，不是画面
源码崩溃。失败的 v008 work directory、manifest 和日志原样保留，禁止清理、覆盖或伪装成成片。

后续显式 job `full-video-current-visual-upgrade-v009` 以 180000ms 预算启动了两次；两次都在
chunk 0 发布稳定 part/chunk/metadata/final 前，因 `Loading locked Noto Sans SC video font`
对应的 `delayRender()` 在 178000ms 后未清除而失败。相同输入的独立
`selectComposition` 诊断约 65 秒成功，说明新的失败点是 render browser 的字体资源交付，
不是 Composition 选择本身。v009 work directory、manifest、日志和 bundle 全部原样保留。

下一候选使用全新的显式 job `full-video-current-visual-upgrade-v010`：1920×1080、30fps、
18000 帧、20×900 帧分段、`concurrency=1`、片间暂停 5000ms。它固定
`AgentSkillLongReview`、Episode 和临时 `voice-v001`，使用全新 final/work 目录，不覆盖
v008、v009 或已被视觉拒绝的历史 v007。分段 bundle 现在只把 Remotion 唯一的字体
`asset/resource` 规则改成 `asset/inline`，并在规则缺失或重复时失败关闭；合同固定
`fontAssetDelivery: inline-bundle`。真实低优先级浏览器证明中，bundle 用时 20.113 秒、
Composition 选择 62.850 秒、H.264 frame 0 渲染 30.526 秒，总计 113.489 秒；其中
`bundle.js` 为 7,991,280 bytes，且输出目录没有额外 WOFF2 文件。该证明只覆盖字体交付链，不等于完整 30 秒 chunk，
因此 v010 chunk 0 仍是中文缺字、回退字体和完整集成的首个门禁。

字体内联修复后的第一次本地完整 `CI=true pnpm verify` 在高并发负载下为 `893/894`：
唯一失败是 64 路旧锁竞争测试中 6 个竞争者超过默认 3 秒等待预算；该精确测试随后以
`test-concurrency=1` 自然退出并 `1/1` 通过。之后不跳项的第二次完整复跑已干净通过：
`894/894` 测试、287 个源码文件、35/35 动效检查、7/7 回滚演练，以及 4 个实际解码且
像素哈希互异的 Remotion 代表帧。
另有针对 durable JSON、分段渲染、通用长片 QA、版本化 JSON 锁、Episode 提交、
Research/Trend、审计 outbox、预算恢复和生产入口隔离的跨模块扩大专项测试 `224/224` 通过。
`pnpm audit --prod --audit-level high` 未发现已知漏洞。以上是隔离工作树证据，不等于
远端门禁、完整十分钟渲染、视觉验收或发布。

## 本轮任务相关修复

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
   两个 Remotion 入口共用 180 秒显式页面/渲染超时预算；专项测试固定两处必须绑定同一值，避免
   8GB 机器在低优先级冷启动下反复撞默认 30 秒超时。为消除第二个浏览器内字体资源链，
   chunk bundle 对 Remotion 唯一字体规则执行 fail-closed 的 `asset/inline` 覆盖；未来增加
   大型 TTF/OTF/EOT 资源前必须重新评估 bundle 体积。

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
   加载完成后继续渲染。该包当前包含 101 个 WOFF2 文件、总计 4,516,508 bytes；这只描述
   包内容，不代表浏览器曾请求全部 101 个文件。v010 的分段入口把受支持字体类型统一内联，
   避免低优先级 render browser 依赖第二条字体 HTTP 交付链。
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

- v008 曾启动完整 10 分钟分段任务，但在 chunk 0 的浏览器初始化阶段失败；没有发布任何有效
  分段、part 或最终目录。没有调用付费 Provider，也没有写入生产 Episode。
- v009 曾两次启动，但都在 chunk 0 因锁定中文字体的 `delayRender()` 超时失败；同样没有发布
  任何稳定分段、part、metadata 或最终目录。同一 v009 work directory 中的两次 worker
  失败记录均保留，可用于只读诊断。
- v010 尚未启动。只有本状态所在新 HEAD 完成选择性 commit、push、最新 hosted `Verify`，且
  clean HEAD、输入哈希、全新输出路径、AC 电源、磁盘和无残留进程复核通过后，才可按
  20×30 秒、`taskpolicy -b nice -n 20` 自动续跑。
- 当前仍没有新的完整 MP4、逐段 ffprobe、无损拼接、音频 mux、联系表或连续 1× 人工观看结果。
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
- PR #7 已进入审阅但必须保持未合并。最终 merge 仍以
  完整十分钟候选、机器 QA、视觉 Skill 检查、连续 1× 人工观看和 Zhengjiazhi 视觉认可全部通过为前提。

- `machine_status`: local_894_of_894_font_inline_fix_latest_hosted_verify_required_before_v010
- `technical_status`: pr_7_open_v008_v009_failures_preserved_v010_not_started
- `business_acceptance_status`: full_video_and_visual_acceptance_not_run
- `git_status`: pr_7_open_no_auto_merge_no_merge
- `release_status`: not_released
