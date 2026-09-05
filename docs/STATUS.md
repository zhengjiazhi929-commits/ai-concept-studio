# AI Concept Studio 当前状态

更新时间：2026-09-05（Asia/Shanghai）
状态真源版本：23

## 本轮目标与边界

Zhengjiazhi 已授权修改并选择性提交长视频相关代码，更新现有 PR #7；本轮不合并 main。
粒子封面已取消：不纳入本次代码提交、PR 或视频；原封面文件和旧视频仍保留。
正式视频右上角动态 logo、无框字幕、语义分句、整体加速和清晰完整的卡片边框继续保留。

风险级别为 R2：跨视觉、字幕和渲染/QA 模块整合。接受标准是针对性回归、完整 verify、
锁定依赖安装与安全审计、提交后的 GitHub CI；这些机器证据不代替成片视觉验收。
回滚方式为撤销本轮整合提交，不重置或清理原工作树、Episode、旧候选或媒体。

## Git 与工作树

- 实时核对的 main 为 `23990937411710e394cde0be5253b02841d42d11`。
- 远端待合并分支为 `codex/reliability-p1-p2-20260831`，整合前提交
  `e09ca7a1d496850d59f37990e5ad733d6505ed3f`，PR #7 保持 OPEN，无自动合并。
- 本轮从该提交创建隔离分支 `codex/long-video-integration-20260905`，整合另一工作树
  `980c4f4` 上尚未提交的长片改动。只更新现有远端可靠性分支，不另建重复 PR。
- 原生产工作树 `codex/agent-production-pipeline@1bb4859` 和原长片 detached 工作树
  保持不动。生成 MP4、音频、QA 输出、render-inputs 和无关数据快照不提交。
- 本文件随代码提交；提交身份以 Git HEAD 为准，GitHub CI 结果以 PR 当前提交的检查为准。

## 本轮整合

1. 同时保留 PR 中已锁定的字重合同和新完整边框规则；语义分组与信息卡不再依赖淡化边线。
2. 正式视频 logo 由全片绝对帧驱动旋转，字幕无底框；节奏默认 1.15 倍，可按内容调整时长，
   不再为了十分钟补慢速停顿。音视频保持同一时间映射。
3. 字幕生成和 QA 共用语义分段逻辑，保留英文单词间空白，限制字幕驻留时间，避免拆词和
   提前显示后文；原文必须与实际字幕或已显示的累计前缀一致，禁止伪造 sourceText 绕过 QA。
   字幕实现加入评测依赖闭包，旧实现证据失效。
4. 整合分段续跑、正式 QA、无框字幕叠加与只读重绑定工具；保留不可覆盖发布和来源绑定。
   历史 job 描述不携带生产输入，不能当作可直接执行的当前渲染授权。
5. 新增测试使用确定性临时夹具，不依赖旧 MP4 或未跟踪的字幕时间轴。
   合成英文字体测试仅证明布局与发布行为，不证明中文视觉质量；正式 QA 的字体来源锁不放宽。
6. 间接依赖 `fast-uri` 从 3.1.5 锁定到 3.1.6，修复审计发现的四条高危通告；
   Remotion、React 和其他直接依赖保持原版本。
   参考：[上游安全通告](https://github.com/advisories/GHSA-jqff-g426-hqxp)。

## 验证状态

- 视觉、字幕、节奏专项：107/107，通过且无跳过。
- generator / production-quality / 字幕语义：27/27，通过且无跳过。
- 渲染与 QA 专项：93/93，通过且无跳过。
- `pnpm install --frozen-lockfile`：通过。
- `pnpm audit --prod --audit-level high`：升级后未发现已知漏洞。
- 完整 `CI=true pnpm verify`：1012/1012 测试，0 失败、0 跳过；302 个源码语法检查、
  35/35 动效检查、7/7 回滚演练、4 张实际解码且像素哈希各异的 Remotion 帧全部通过。
  暂存新文件后的秘密扫描、working-tree/index/untracked diff 检查均通过。
- 本记录随整合代码提交，无法预先证明该提交之后的 hosted CI；最终云端结果以 PR #7
  当前 head commit 的 checks 为准，不复用 9 月 1 日旧 CI 结论。
- 首次整合提交 `deb72ed` 的 hosted push/PR runs `33953013376` / `33953014689`
  失败于本机 Python 默认路径和模块顶层 Homebrew realpath。后续补修将文件发布使用的 Python
  显式承接 CI 的 `QA_PYTHON`，缺失指定路径时失败关闭，不放宽视觉测量的来源锁；
  FFmpeg/FFprobe 只在真正运行 proof 时解析，且早于输出建目录。
  回归使用 Node 权限机制禁止访问 Homebrew 后实际导入成功，不创建假系统目录或跳过测试。
- 本轮没有重新渲染完整视频、修改人工 Gate 或调用付费生成服务。

## 合并与发布门禁

即使本轮 CI 通过，也不立即 merge：需要与当前源码绑定的完整视频、正式机器 QA、
视觉 Skill 检查、连续 1× 观看以及 Zhengjiazhi 的最终视觉认可。
视频无需凑满十分钟；旧版本 QA、局部片段和四帧 render smoke 都不能替代此门禁。
临时系统合成旁白（包括 voice-v001）不是最终真人录音。

- `machine_status`: local_verify_1012_of_1012_passed_hosted_evidence_per_pr_head
- `technical_status`: long_video_integration_code_verified_visual_acceptance_pending
- `business_acceptance_status`: current_integrated_video_not_accepted
- `git_status`: pr_7_selective_code_update_no_auto_merge_no_merge
- `release_status`: not_released

历史 v21 原文已保存在 [2026-09-01 状态归档](./archive/STATUS-20260901-v21.md)，其中的
分支、未提交状态、测试数和渲染进度仅代表历史快照，不是当前结论。仓库保护设置本轮未更改，
也未重新核验；不得把旧快照中的设置描述当作今天的安全保障。
