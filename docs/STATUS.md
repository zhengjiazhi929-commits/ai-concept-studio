# AI Concept Studio 当前状态

更新时间：2026-10-21（Asia/Shanghai）
状态真源版本：76（PR #8 审查问题整改，验证与合并分别记录）

## 当前任务：修复候选 PR 审查问题并重新验证

- Zhengjiazhi 已授权修复3个已复现P2、补强1个P3测试断言、分批提交并推送现有
  [草稿 PR #8](https://github.com/zhengjiazhi929-commits/ai-concept-studio/pull/8)。
  新提交的 hosted CI 通过后再决定合并；本轮不合并、不部署、不调用付费服务、
  不操作真实 Episode/Gate、不渲染新整片。下方旧“未授权建PR”已被本次授权取代。
- 在原隔离候选分支 `codex/verified-system-delivery-20261020` 整改；原脏工作树及媒体保持。
  main 基线仍为 `0c2b1cdc993a8c9492ab5a091573d673ac60503d`。
- 已补强4项语音访问器测试，27/27通过；提交 `3409d7b`。
- 已修复人工选题在异步操作后授权过期仍继续写入的问题，相关56/56通过；提交
  `bf6b3ed`。Episode已提交时保留后续人工状态，以新授权恢复派生指针。
- 已统一当前v2与历史v1的审批展示合同，保留严格的实际批准边界；相关77/77、
  独立审批复核41/41通过，含真实HTTP模块加载；提交 `1ea1e57`。
- 章节目录与连续真实时间轴已提交 `94bd7a8`；字号不缩小，章节刻度不人为扩宽。
  聚焦58/58、真实字体60帧、0.5倍缩放及8种故障拦截已通过；合成局部截图已检查，
  这不是新的整片或用户视觉验收。
- 最终实现绑定为 `agent-control-release-v18`，236个路径，SHA-256
  `416af8a736645b04188cf350c0a3348fa7d03179f034b25e9a2c282c52929732`；
  每批独立更新版本，旧评测证据失效，`admission.eligible=false` 保持。
- 上述最终源码 `94bd7a847b235a65001cdd6b1ddbf4afd918026f` 的精确 frozen install、
  production audit 与完整 `pnpm verify` 已通过：1812/1812，零失败/跳过/取消；
  433源码语法、35动效、回滚演练、三项合成渲染/真实浏览器smoke、diff检查通过。
  当前生产依赖没有已知通告；不是无未知漏洞保证。
- 本轮26个可审代码路径逐项复核，0跳过；授权恢复、审批实际批准边界、导航字体
  DOM和访问器断言均有独立交叉复核，没有已确认未解决的本轮阻断项。
  本文档提交仅记录已完成的本地检查，不预先宣称其 hosted CI 通过；须核对
  [PR #8](https://github.com/zhengjiazhi929-commits/ai-concept-studio/pull/8)
  的精确 head SHA 和对应 Verify。之前的1793项及旧CI不作为新实现通过证据。
- machine_status=local_full_verification_passed；technical_status=review_findings_remediated；
  business_acceptance_status=chapter_navigation_confirmation_pending；
  release_status=draft_pr_merge_not_authorized。原成片不变，本轮没有新的整片验收。
- 机器检查、用户视觉确认、视频成片验收及merge分开；详见
  [PR审查整改说明](49-pr8-review-remediation.md)。

## 2026-10-20 选择性交付历史（不是本轮新实现的验证结果）

### 按依赖整理候选分支

- Zhengjiazhi 已授权筛选累计改动、分批 commit + push；GitHub CI 通过后再确认是否合并。
  不授权创建 PR、合并、部署、付费调用、新成片渲染或 Episode/Gate 变更。
- 从 main `0c2b1cdc993a8c9492ab5a091573d673ac60503d` 在隔离分支
  `codex/verified-system-delivery-20261020` 组装；原脏工作目录及媒体保持。
- 第一批包含锁定依赖安全补丁、Host/Origin 边界和相关回归，聚焦测试 62/62 通过。
  当前生产依赖审计零通告；没有将这个结果说成 hosted CI 或无未知漏洞。
- 第二批已纳入受控公开发现、人工选题及研究来源绑定；相关测试 164/164 通过。
  拆分工具曾误裁评测绑定名单，7 项回归正确拦截；修正后完整重跑该组通过，
  未提交失败版本，也未放宽评测校验。
- 第三批编辑生产链及屏显规则已组装，相关专项 118/118 通过；新增合成计划
  代替对私人制作计划的测试读取。参考实现绑定 v15 与原实现一致，
  `admission.eligible=false` 保持。
- 第四批三组静态示例及准确字体入口已加入，专项 14/14 通过，未改画法或生成新视频。
  四批源码提交的最终版本为 `9ba00ec62b2f9d07586df81de15122646601a553`。
  私人生产计划、运行数据及生成媒体不提交。
- 每批源码变化使旧评测失效；参考评测保持 `offline-reference-only`，不获得正式准入。
- 上述源码版本的 exact frozen install、production audit 和 canonical `pnpm verify`
  已通过：1793/1793，0失败/跳过/取消；429源码语法、35动效、回滚演练、
  三组真实浏览器 smoke 和 diff 检查通过。新增测试使用合成数据，不读取原制作文件。
- 提交范围共275路径：273项原源选择加交付文档及合成fixture；23项原本地文件排除。
  原1199文件、原HEAD/分支及dirty清单核验不变。完整命令与结果保存在本地交付证据中。
- 本文档提交只记录上述已完成验证，不预先宣称 hosted CI 通过。实时结果须核对
  [候选分支的 Verify](https://github.com/zhengjiazhi929-commits/ai-concept-studio/actions?query=branch%3Acodex%2Fverified-system-delivery-20261020)
  与 [候选提交](https://github.com/zhengjiazhi929-commits/ai-concept-studio/tree/codex/verified-system-delivery-20261020)
  的精确 SHA。main 仍是原基线；PR/merge 需用户另行确认。
- machine_status=local_full_verification_passed；technical_status=selected_candidate_verified；
  business_acceptance_status=static_examples_only；release_status=merge_not_authorized。
  机器检查、静态视觉接受、成片验收和合并分开记录。
- 交付范围、验收及回退见 [选择性 Git 交付](48-selective-github-delivery.md)。

## 以下是已合并基线的历史记录（不是当前授权或验证结果）

更新时间：2026-09-09（Asia/Shanghai）
状态真源版本：38

## 当前任务：筛选可复用视频能力并合入 main

Zhengjiazhi 明确要求“你查一下吧，把有用的都合并了，接下来我要做完整的新视频了”。
本轮授权代码筛选、必要修复、测试、提交、推送与通过检查后合并，不是旧长片或新视频的成片批准。
原“旧片验收后才合并”的代码交付顺序由本次明确要求调整为先整合可用代码，再制作新片；
Research、Script、Storyboard、Assets/Voice、Final 五道人审和任何生产 Episode 状态不变。

## 范围、风险与回退

- R3：PR #7 的可靠性、字幕/节奏/边框/字体/水印、分段渲染与 QA 基础，加上已认可视觉参考的复用代码。
- 独立整合分支 `codex/approved-video-system-20260909` 从PR #7的 `1c6f44e4bc1388bd00f62c9fffc4a6bdd740dd7d` 创建；原视觉工作区和旧媒体不修改。
- 开始时远端main为 `23990937411710e394cde0be5253b02841d42d11`，唯一未合并远端分支为 `codex/reliability-p1-p2-20260831`（PR #7）。
- 纳入二维对象/动作库及20秒按需加载、微磨砂内容卡片、三组静态分镜；已认可的样例范围与原哈希分别见docs/14、15、16。
- 排除spatial/journey两版3D、three/R3F/Remotion Three依赖、已取消粒子封面、生成视频/图片/音频、旧Episode和未审生产素材。旧实验留在原工作区，不删除。
- 回退为撤销本次代码整合提交/合并，不覆盖生产Episode、历史候选或其他工作树。

## 本轮修复与验证

- 字体入口回归从旧数量断言升级为11个准确路径名单，逐入口检查本地字体加载。先失败1/1，修复后相关视觉专项111/111通过。
- 修复资料A→B→重试A时当前pack与历史路径错配；实际临时存储回归先失败，修复后17/17 research测试通过。重试不重复写Episode、不回退B，返回路径与内容一致。
- 实现绑定哈希更新为 `ac80fc17650ac8f269912576b75894003107479d522935c38636db9d7fffb0df`；旧实现评测证据不沿用，不提高准入级别。
- 独立Node24.19.0 / pnpm11.19.0 frozen install通过，未引入3D依赖；生产依赖审计未发现已知漏洞。
- 本机捆绑Python已变为3.12.14；另建隔离CPython3.12.13副本虚拟环境，按仓库哈希锁安装NumPy2.3.5/Pillow12.3.0，真实运行时身份校验通过；未放宽版本合同或修改系统Python。
- 整合源码新生成9张静态分镜，字节及像素哈希均与已认可 `candidate-8wfU6K` 完全相同。新候选 `outputs/merge-audit-20260909/storyboards/candidate-w0WwMl`，来源1440项，sourceHash=`639451ac788cd89ba6e3d6916d724db1b38313c21bd74c909ede9655948eb661`。旧清单未改写。
- 修复历史v004d proof只绑定清单而未绑定实际overlay PNG/600帧引用的漏洞，新增消费前后素材完整性检查；专项10/10通过。
- 修复联系表依赖未锁定QA缓存图的问题，改为从哈希绑定的MP4按索引精确解码到私有新目录；合成错图测试和相关测试5/5通过。
- 修复字幕输出的符号链接越界；CLI和writer在创建目录或写入前拒绝symlink祖先、最终目标及范围外路径；18/18通过。
- 卡片三张PNG也与原认可版本逐字节一致。二维动画样例另生成9张静帧用于回归，未生成或验收新的MP4。
- 完整本地 `CI=true pnpm verify` 通过：1138/1138测试、零失败/跳过，323文件语法、35项动效库检查、7/7回退演练、四帧实际渲染及秘密/diff检查通过。
- Open Code Review 委派审查覆盖185个可审代码路径；其中30个历史大文件为重点差异/风险路径审查，不宣称全部未改行深审。四处问题修复后交叉复核，无已知未解决P1/P2；历史归档不作为当前运行依据。
- 二维样例九张静帧中八张与原版逐字节一致；第0帧仅背景渐变出现最大1/255的RGB差，Logo区域完全一致，无已证内容/布局回归。浏览器补丁及渲染顺序不同，具体触发原因未唯一确认；不改写旧认可范围。
- 本页记录提交前已完成的验证；同一提交的hosted CI必须通过后才允许合并。实时CI、提交和合并事实以 [PR #7](https://github.com/zhengjiazhi929-commits/ai-concept-studio/pull/7) 及GitHub refs为准，旧1012/1012及旧CI不是本次结果。

## 合并、使用与视频验收状态

| 层级 | 当前状态 |
| --- | --- |
| 代码整理 | 已完成本轮筛选、修复与交叉审查；通过PR #7交付，实时合并事实见GitHub |
| 机器验证 | 本轮完整本地verify已通过；hosted CI按当前提交绑定，合并前必须通过 |
| 视觉参考认可 | 20秒二维样例方向、三张静态卡片材质、三组静态分镜已获限定版本认可 |
| 新完整视频 | 尚未选题、编排或渲染，不自动沿用旧生产输入 |
| 成片/发布 | 旧长片未新增验收，新片未验收，没有部署或发布 |

入口与使用边界见 [新视频制作基线](./17-new-video-baseline.md)。
历史2026-09-05状态见 [归档](./archive/STATUS-20260905-pre-approved-video-integration.md)。
