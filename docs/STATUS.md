# AI Concept Studio 当前状态

更新时间：2026-10-24（Asia/Shanghai）
状态真源版本：96（核对旧备份分支交付；通用内容已进入 main，补交对账文档，不合并最新工作分支）

## 当前执行：旧备份分支交付核对

- Zhengjiazhi 选择逐项核查旧提交、补传仍有价值的代码和文档，排除视频内容、运行数据及敏感文件，不合并 main。
  范围是两条旧备份分支的 13 个唯一提交；不代表其他旧工作树未提交文件已全部审计。
- 旧范围共 186 个路径：181 个与已合入拆分快照 857a4a2 的 blob 完全相同，4 个差异已逐项解释，
  1 个 live golden Episode 状态刻意排除；范围内 185/185 完成交付核对，没有发现缺失的通用代码/文档。
  旧 commit ID 不在远端祖先链上，不等于代码漏传；不重复 cherry-pick、不恢复旧批准、不删除备份分支。
- 本轮只补交[核对报告](26-legacy-branch-reconciliation.md)、[逐路径证据](evidence/legacy-branch-reconciliation-20261024.json)及本状态记录。
  风险 R0，运行代码、依赖与 v22 实现指纹均不变；五份已有运行数据及本期内容继续保留本机。
- 核对基线：origin/main=000a990；工作分支 codex/video-discovery-20261022=374a878，后者已在 GitHub 但尚未合入 main。
  精确绑定 374a878 的 [GitHub Verify 39976068022](https://github.com/zhengjiazhi929-commits/ai-concept-studio/actions/runs/39976068022)
  已核实 completed/success。此前干净 clone 2084/2084 是该代码基线证据，不冒充新文档提交的 CI。
- 本轮 R0 核验通过：186 路径清单唯一且完整、744 个 blob 比对、22 项祖先关系、4 个本地链接、秘密扫描和 diff 检查。
  现有视觉测试 36/36、CI 治理测试 3/3 通过，0 失败/跳过。文档审查 3/3，0 跳过；未重跑全量 verify 或生产渲染。
  没有新视频验收、PR 或合并；本次文档提交的新 CI 需 push 后按实际 HEAD 核对，本期制作继续停止。
- machine_status=historical_delivery_reconciled_r0_checks_passed；technical_status=no_missing_reusable_changes_found；
  business_acceptance_status=episode_production_stopped_by_user；release_status=documentation_branch_delivery_only_not_merged。

## 先前阶段：停止本期制作，选择性提交代码（v95历史）

- Zhengjiazhi最新要求“这个新视频先不做了，把该提交的提交上去就行”，覆盖下方历史继续制作计划。
  本轮只整理可复用源码、配置、回归测试与开发文档，提交至`codex/video-discovery-20261022`；不自动建PR或合并main。
- 本期手工Episode、研究/讲稿/分镜、审计账本、输出文件保留本机，不上传、不删除、不重放；
  五份已有tracked发现运行数据不纳入提交。没有开启Operator、声音、正式渲染或付费调用。
- 提交前代码审查发现五项P2：窄章节文字溢出、嵌套区域连线误拦截、Script请求getter提前执行、
  研究配置漂移、研究包实际消费前完整性缺口。按最小范围修复并补反例，不扩大权限或降低审核门槛。
- 章节名称使用独立等宽单行布局；进度轨仍按真实时长比例，不把短章文字压入狭窄轨道。
  连线排除端点完整祖先区域，仍拦截非祖先障碍；这些通用修复不代表本期视频已通过视觉验收。
- 新机器接续说明见[new-machine-setup.md](new-machine-setup.md)：锁定运行时、干净安装、验证入口、
  源码与本地制作数据边界。clone可恢复代码，不会自动恢复本期制作状态或本机凭据。
- 代码审查覆盖72/72文件（65代码/配置/测试、7文档），0跳过；五项P2均补红绿回归，独立复核未发现剩余P1/P2。
  最终实现`agent-control-release-v22`，261路径，hash `ef178da56daa4ad954edb5033fb7dbe78bd2d456de36b66bf3c4c3813a01b37c`；
  配置绑定同步，admission.eligible=false、shadow/fixed fallback不变。
- 2026-10-23，无本期数据的隔离clone执行锁文件安装及完整`pnpm verify`退出0：**2084/2084，0失败/跳过**；
  秘密扫描、语法、动效合同、回滚7项、四类合成浏览器smoke和diff检查全部通过。`pnpm audit --prod --audit-level high`未发现已知漏洞。
  验证源码树`67960a4163401c052bb64fd9d8e396e3cea7eb8a`；之后只更新本状态文档记录结果，不改运行代码。
  本地完整日志与逐文件审查账本保留在忽略的交付证据目录，生成物不提交。GitHub CI须以实际push的HEAD另行核对。
- 下方v21/2068项属于历史证据。本期停点仍为stateVersion28、Storyboard v2机器pass/人审pending；
  更换实现后若恢复制作，须重新核对绑定，不复用旧审核结论。源码验证不等于本期视觉验收。
- machine_status=clean_clone_verify_2084_passed；technical_status=reusable_changes_verified_for_branch_delivery；
  business_acceptance_status=episode_production_stopped_by_user；release_status=branch_delivery_only_not_merged_no_video_release。

## 先前阶段：可执行分镜与封闭零费用机器审核完成（v94历史）

- Zhengjiazhi明确认可分镜方向，授权补齐可执行分镜与零费用审核入口。本轮保留已批准Script v3原文及顺序，
  没有自动批准分镜、启动Operator/配音/本期渲染、付费或Git操作；同工作树、分支和HEAD，先前dirty内容保留。
- 新候选v5实现24镜、129个原文cue、812个对象事件、39个轨道状态。独立语义插画、正交反馈/范围、实际纸页复制与入托盘、
  受限位移与无字轨道均成为可复算合同；14次材料到达有来源和容器状态，不伪装业务审批/核验成功。
  S17采用金额对照+停止边界，不宣称金额越闸或比例量尺。四章按场长比例，约506.1秒仍是编辑估时，不是实际声音。
- 通用实现与安全复核说明见[执行合同](24-executable-storyboard-review.md)、[零费用审核入口](25-local-storyboard-review.md)。
  新CLI默认只读预览，精确版本/hash/快照/操作者/原因确认；锁内重新核对磁盘、已批准上游、配置与实现，真实CAS/审计/恢复，
  0 calls/$0，不提供Provider/数据根/预算覆盖。机器pass不代替五道人审；提交后观察器告警不假报回滚。
- 对隐藏端点旧连线复活、轨道穿字、并发位移穿越、托盘遮挡及章节顶层注入补反例并修复；不降低阈值。
  新合成浏览器smoke验证真实像素轮廓、关系线、原件/副本、托盘遮挡、不等长导航与全局帧logo；不是本期视觉验收。
- 冻结实现`agent-control-release-v21`，260路径，hash `37d9402d27bcfad49177406fbb005e7135828fec5bb8505419216d834c2b7e1a`。
  配置绑定已同步；旧评测不复用，admission.eligible=false、shadow/fixed fallback保留。依赖未改，本轮未重跑依赖audit。
- 最终完整`pnpm verify`退出0：**2068/2068，0失败/跳过**；秘密、语法、动效、回滚、四类合成浏览器smoke与diff全部通过。
  日志`storyboard-v94-frozen-verify.log`；前两份verify是较早快照，不作为最后绑定。审核入口专项66/66，最终章节关联83/83。
  另核对129/129屏显、749编译几何采样、1102语义/材料模型采样，及**15183/15183逐帧模型，0抛错**。
  模型检查不证明浏览器像素、连续动效或音画同步；本期实际视觉验收仍未完成。
- 2026-10-23T12:00:56Z，通过正常CLI一次性导入与机器复核：正式**Storyboard v2（候选v5）**，stateVersion28；
  commit/audit均committed，activeOperation/pendingDispatch=null，review=passed、人审pending。报告
  `review-storyboard-v2-1-2026-10-23T12-00-55-203Z`：38项通过、0阻断、1项素材警告，要求最终QA前绑定真实登记素材。
- Gate hash `85ae165e13020535083123533c3b2ffadf77e44cb9b0b6da77a479e41d4031b6`；候选SHA
  `ee0828fa5fad9922dcb5efdbbfcac4aa1c44d5f55980cb573eb437fefad71179`；正式文件SHA
  `324a6de104d757ef6ddb5d35d75a42f701b41bb02fba73305772e5b96998921b`。13份研究/旧稿/清单、研究和脚本批准、
  所有其他Episode、模型调用与预算核对不变，使用/保留仍0。不把系统committed误称为Git提交。
- 证据目录`outputs/topic-discovery-20261022.qXumz5/`：`HARNESS-STORYBOARD-EXECUTION-REVIEW-v5.md`、
  `HARNESS-STORYBOARD-FRAME-MODEL-AUDIT-v5.json`、候选/PREFLIGHT/TIMELINE-v5，及`HARNESS-EXECUTABLE-V5-VERIFICATION.json`。
  builder的--write与register-harness-executable-v5.mjs均已消费，wx防覆盖，不整份重放。
- 下一步：本期关键镜头实际画面/动效预览与精确Storyboard v2人审，之后按workflow分别推进素材、声音和音画对齐；
  本轮方向认可不自动扩大为后续生产批准。最终QA须消除真实素材绑定警告，不把素材提示当实际证据。
- machine_status=frozen_full_verification_and_storyboard_v2_review_passed；technical_status=executable_storyboard_registered；
  business_acceptance_status=storyboard_v2_human_approval_and_visual_review_pending；release_status=uncommitted_no_video_release。

## 先前阶段：已批准讲稿完成流转，分镜内容审看稿交付（v93历史）

- Zhengjiazhi本轮明确“1，认可这版讲稿，继续分镜”，绑定上一轮候选v4/正式Script v3及其精确hash/report。
  消费此前尚未使用的临时Operator许可，仅经正常session/CSRF登记本期Script批准；recoverOnStart:false，0 calls/$0，
  凭据仅内存，完成即关闭且端口连接拒绝。随后既有complete-approved-script CLI正常预览/确认，Script approved/complete。
- 新分镜候选v4按原文26个源单元拆24镜、129拍：S01–S06先概念，S07首次采购示例，S13–S18异常，S19–S24落地。
  hook、正文及closing不改；每拍完整声明可见文字，章节导航随大纲逐一命名后常驻；同身份物件位置稳定，不每句清屏。
  薄荷、轻磨砂完整边框、短深色字、独立语义图、正交箭头、动态logo、无框字幕均为制作要求，尚未渲染验收。
- 独立审阅修正：S16防重不等于一定建单成功；S23简化不等于移除；S17总额在对应口播出现、停止后显；
  S22分类保留并高亮，S24保留轨迹避免快切。最终两份作者稿与编译候选一致，129个cue精确按序命中，未发现剩余语义阻断。
- 正常本地分镜CLI已入库为**正式Storyboard v1**（候选v4），commit/audit均committed，stateVersion25。
  Gate hash `4376a513a5a289d3689523a2a8f50939e5b32936e49f49b79a4538d2c5b224b2`；
  候选SHA `092fdc7e28c48582e91e8f13aeb94c733307f4c01a9874755dadbfddd083c4a4`；
  正式内容SHA `6e112e4c4f24657d24ad8182c0c22051eb682a5a7b7b558e5f2144fc7cd8837b`。
  Storyboard review=not_started、approval=pending、kind=editorial-cue-plan-v1、timing=unmeasured、execution=implementation-required。
- 流转/导入/权限等现有专项69/69，屏显/时间轴专项25/25，均0失败/跳过。候选合同、完整声明文字集合、原文唯一覆盖通过；
  24组编辑估时可编译为506.1秒，四章约131/123/127/125秒，非实际声音比例。
  S22“工具失败”估时停留0.9秒，仅高亮变化且标签继续保留，后续仍需按实音检查；不是已验证动画。
- 只读production quality诊断真实为未通过：9项阻断，集中在尚未实现时间轴/执行合同、正式scene类型/字幕覆盖等。
  这不是已执行的正式Gate报告；纯编辑稿入库会清空未实现timeline，不能把离线编译结果或129cue冒充正式字幕/画面覆盖。
  独立受控零费用Storyboard复核CLI/HTTP仍缺失；不直接调用传统recheck写路径，不用storyboard-agent/run代替复核。
- 研究/脚本批准与正文、5份研究文件、所有旧Script/manifest、其他Episode及模型/预算使用均核对不变；activeOperation/pendingDispatch为空。
  无新运行源码、付费、声音、渲染或Git操作；未重跑全量verify，不复用旧1919结果作为分镜验收。
- 可读分镜`outputs/topic-discovery-20261022.qXumz5/HARNESS-STORYBOARD-v4.md`；源稿SHOTS-A/B-v4.json，候选/预检/时间轴同目录。
  批准凭据`HARNESS-SCRIPT-V3-APPROVAL-VERIFICATION.json`，分镜入库凭据`HARNESS-STORYBOARD-V4-IMPORT-VERIFICATION.json`，
  独立审阅`HARNESS-STORYBOARD-SEMANTIC-REVIEW-v4.md`。本轮三个一次性runner已消费，不重放。
- 下一步先请用户审阅分镜方向；要完成正式分镜阶段仍需可执行动作/几何与新版本、受控零费用机器复核入口，再按精确版本人审。
  分镜内容方向认可不等于自动批准未实现稿的正式Gate；继续制作不扩大为付费、Git或成片发布。
- machine_status=editorial_contract_checks_passed_formal_storyboard_review_not_started；technical_status=cue_storyboard_registered_execution_required；
  business_acceptance_status=script_approved_storyboard_direction_pending；release_status=uncommitted_no_video_release。

## 先前阶段：概念先行改稿完成，正式Script v3等待内容确认（v92历史）

- 用户指出“要先讲概念，再带入案例”，随后选择先完整讲概念与关系、再进入企业采购的方案1。
  这覆盖前轮口播逐字不变的限制，授权本次编辑改稿，不等于批准新讲稿、分镜或制作。
- 已改写hook及H01–H04：主题与四章大纲 → Harness定义/作用 → Loop、Workflow、Harness关系 → 企业采购案例。
  H01–H03口播及画面说明均无提前采购演示，H04明确说明案例为教学示例，非客户实测或框架保证。
  H05–H12口播及closing不变；H12画面改为“核对订单结果”，不再无依据呈现“已核对”。
- 离线候选v4通过正常CLI导入为**正式Script v3**；旧v1/v2、manifest、候选v3、5份登记研究文件及其他Episode字节不变。
  新稿不再声称逐字等价，不能复用前轮口播SHA或分镜锚点。候选SHA
  `4b5d0264e642a9109f98da065cc315b15063eeacce17f8c4e45a627ef379d3be`。
- 独立语义复核无明确阻断；既有入口/时间轴聚焦测试**98/98通过、0失败/跳过**。
  候选合同及9项离线质量检查通过；26源单元编译为24组时间轴，每组4–8条字幕。
  约506.1秒仅编辑估时，不是配音时长；时间轴可编译不代表分镜、视觉或音画验收。
- 2026-10-23T10:39:49Z导入及机器审核均committed、审计committed，18项pass、0问题/警告。
  stateVersion22，activeOperation/pendingDispatch为空；Script review=passed、approval=pending；Research仍approved/complete。
  Gate hash `42d074d549004c2388ae57c9435770c3450d37f717e49c1eaf27cece3bf79ba9`；
  报告 `review-script-v3-3-2026-10-23T10-39-49-073Z`；正式文件SHA
  `00469526d33e3a55ce4fe68a6db24cd9ea87959cee01483ae7dde86ef4accb7c`。
- 证据目录仍为`outputs/topic-discovery-20261022.qXumz5/`；可读稿`HARNESS-SCRIPT-v4.md`，
  预检/时间轴`HARNESS-CONCEPT-FIRST-{PREFLIGHT,TIMELINE}-v4.json`，正式核验`HARNESS-CONCEPT-FIRST-VERIFICATION-20261023.json`。
  两个concept-first-v4 builder/registration脚本均已消费，不整份重跑。
- 本轮无运行源码、Git、Operator、配音、渲染或付费；模型使用及预算使用/保留不变且为0。
  本轮未重跑全量verify，v89的1919项结果不替代当前内容或未来视觉验收。
- 下一步：请用户确认新讲稿后，再按精确版本登记批准与制作分镜。旧71拍草案的H01–H04必须改写，
  全部口播绑定与时间轴重新核对；不能沿用旧稿批准或把时间轴可编译当成分镜已验收。
- machine_status=concept_first_v3_script_review_passed；technical_status=concept_first_script_registered；
  business_acceptance_status=concept_first_script_confirmation_pending；release_status=uncommitted_no_video_release。

## 先前阶段：结构整理完成，正式Script v2等待精确版本确认（v91历史）

- Zhengjiazhi 明确授权“保留口播文字和顺序，只调整脚本结构，继续”。本轮没有改运行代码、主题、案例、
  视觉方向或时长参数；只将原首句/末句移入hook/closing，各节按句意分两段，同步第一条非朗读编辑说明。
- 离线候选v3经既有正常CLI导入为**正式脚本v2**。旧v1及旧候选字节保留，版本号不同不要混用。
  新hook+分段正文+closing在只移除新增段落分隔符后，与原12节正文逐字符相等，包括标点与英文空格；
  口播SHA-256 `a759d32fefe2fb0f04d729dc3c11adc611d1a57f5deb76fb5ff9e015c24b851e`。
- 26个原文单元顺序覆盖一次、24组时间轴通过现有编译器，每组4–8条字幕，场长约15.67–26.57秒；
  505.13秒仅编辑估时，不是实际配音时长或正式分镜。初次断点方案被字幕最小时长检查拒绝，调整句意断点后通过；未放宽门槛。
- 既有入口与时间轴聚焦测试98/98通过、0失败/跳过；候选合同、逐字符等价、实现绑定及磁盘证据核对通过。
  独立只读复核从不可变BEFORE取旧v1，确认仅许可字段变化、20个英文空格保留；重新编译133条字幕与保存结果一致。
  本轮未改运行源码，未声称重新完成全量verify；前轮1919项仍仅对应v89实现。
- 2026-10-23T08:39:59Z正式导入与零费用脚本复核均committed、审计committed，无警告。
  stateVersion19，无activeOperation/pendingDispatch；Script review=passed、approval=pending，Research仍approved/complete。
  当前Script Gate hash `0613df08dc1320d93988313015408140abbf9354e3fc4c405675c3d89480ab27`；
  报告 `review-script-v2-2-2026-10-23T08-39-59-067Z`，18项通过、0问题、0警告。
  正式文件SHA `0d3a0404b04ad0143835beb6e4836e32b842bf0fc65fe78ed88be45a33bb086a`。
- 旧脚本、旧manifest、5份登记研究文件及其他Episode字节核对不变；模型使用、预算使用/保留不变且为0。
  无Operator服务器、付费、声音、渲染或Git操作。用户对旧口播内容的认可不自动替代新版本/哈希的人审登记。
- 新可读稿为 `outputs/topic-discovery-20261022.qXumz5/HARNESS-SCRIPT-v3.md`；逐字符/时间轴证明为
  `HARNESS-SCRIPT-STRUCTURE-{PROOF,TIMELINE}-v3.json`；正常入库审核证据为 `HARNESS-STRUCTURE-*-20261023.json`。
  两个builder/registration脚本均已消费，wx防覆盖，不整份重跑。
- 下一步：确认正式v2后才登记脚本批准并推进分镜。上一轮12组71拍草案只是内容意图，需重新绑定v2并拆可见子状态，
  不复用v1绑定或把24组时间轴预检当成动作/几何/声音验收；结尾不根据旧visualDirection擅自宣告订单核验成功。
- machine_status=structure_equivalence_and_v2_script_review_passed；technical_status=script_structure_registered；
  business_acceptance_status=normalized_script_v2_confirmation_pending；release_status=uncommitted_no_video_release。

## 先前阶段：讲稿认可，登记前发现下游结构不兼容（v90历史）

- Zhengjiazhi 已选择认可当前讲稿并继续分镜，且明确允许临时启用全 Studio 零费用 Operator，
  仅登记本期脚本批准、关闭启动恢复、完成即关闭。这是已获授权，不再重复询问同一权限。
- 登记前只读追踪发现两项真实兼容问题：当前 `hook/closing` 是“不额外朗读”的编辑摘要，
  但分镜导入合同强制把它们当作旁白单元；12节各只有一个段落单元，每单元拆出10–14条字幕，
  而编辑时间轴每场上限8条且不能拆分同一源单元。此前18项脚本机器检查未覆盖这两项下游条件。
- 因此本轮未启动 Operator、未登记批准或导入分镜，也未改写已登记脚本、扩大字幕上限或新增运行代码。
  人类对内容的认可与系统登记分开：Script approval 仍 pending，stateVersion 仍16，
  Gate hash/report保持v89记录；activeOperation/pendingDispatch为空，Research仍approved/complete。
- 已按原口播整理12组、71拍离线分镜草案，采用短屏显、明确语义对象、逐句口播锚点；这是内容分组，
  不是最终12个计时镜头。核对范围为原文锚点、顺序、屏显预算与语义，不表示实际动画、布局、配音或音画验收。
  最新可读稿 `outputs/topic-discovery-20261022.qXumz5/HARNESS-STORYBOARD-v3.md`，对应OUTLINE/PREFLIGHT-v3.json，
  v1/v2保留不覆盖。71/71原文锚点顺序命中，声明的主要状态屏显预算通过，目标为同时最多3个主对象；
  同一概念拍内的替换词尚需拆可见子状态再逐帧检查，不能将当前参考清单当成可直接渲染的完整时间轴。
  修正H04第四对象、H07授权限定和H12无依据宣告核验成功；没有改口播原文。
  源Episode字节和正式脚本磁盘SHA检查不变；构建脚本语法与git diff检查通过，不进入正式生产输入。
- 最小后续路径是新建结构整理版脚本：将实际首尾口播放入真正的hook/closing，各节按句意分段，
  证明合并后口播文字和顺序不变，再运行新版本审核并交用户确认。当前尚未执行，不复用旧版精确哈希批准。
- 本轮没有付费、生成媒体或Git操作；旧运行源码及所有先前dirty内容保留。
  下方1919项全量验证属于v89运行代码验证，不冒充本轮分镜或未实现后续修复的验证。
- machine_status=script_review_passed_downstream_incompatibilities_found；
  technical_status=offline_storyboard_draft_only；business_acceptance_status=script_content_accepted_registration_pending；
  release_status=uncommitted_no_video_release。

## 先前阶段：零费用机器审核通过，等待讲稿人审（v89历史）

- 用户选择“补齐并测试零费用机器审核入口，再送讲稿人审”。本轮 R3 仅增加本地已导入 Script 的受控复核入口，
  不改正文，不批准任何 Gate，不生成分镜/声音/视频，不启用 HTTP Operator，不 commit/push/merge。
  使用当前附属工作树 `selective-github-delivery/ai-concept-studio`、`codex/video-discovery-20261022`；
  HEAD 仍为 `000a9901779a71f0670d5fa8e2ccf17f0ffd8c9e`，先前发现/Research dirty 内容保留。
- 新入口见 [本地确定性脚本审核](23-local-script-review.md)：只读预览后必须显式声明操作者、原因、版本、
  内容哈希和完整快照；五分钟进程内精确授权，只有 `state.write`，0 calls/$0。Kernel 在锁内复核实际脚本、
  清单及全部登记研究文件、研究批准、审核配置和实现指纹，使用真实 CAS、持久化操作与恢复，不传入 Provider。
  专用授权不能进入其他 sink；过期不得继续写。提交成功后的审计或持久化警告如实区分，不误报回滚。
- 先红后绿；扩大专项 **129/129**，其中最终 Kernel 专项 **37/37**。独立交叉审阅无剩余已确认阻断。
  本轮完整 `pnpm verify` 已完成，**1919/1919、0失败、0跳过**，包含秘密/语法/动效、回滚、三类合成浏览器渲染及diff；
  production audit 无已知漏洞。使用锁定 Node24.19.0、pnpm11.19.0、CPython3.12.13，未改依赖或放宽版本。
- 当前实现绑定 `agent-control-release-v20`，250路径，SHA-256
  `2b0622f44244d1602019a232bf61c8346fe826badb57b6da6c59a204b043fda7`；旧评测失效，`admission.eligible=false`、shadow/fixed fallback 保持。
  这是本地验证，不表示新分支 hosted CI、合并或成片验收。
- 验证完成后，2026-10-23T05:02:13Z 通过正常 CLI 对唯一目标 `agent-harness-manual-2cb40075fda50bb9` 执行一次。
  正式脚本仍v1（正文来自离线候选v2），Gate hash仍
  `ff86a897be8b3c6f3b7a2fa4c8b65aa610f252c64a9b3b6bc8a2c4a19e1c0093`；
  报告 `review-script-v1-1-2026-10-23T05-02-13-602Z` 为 deterministic/pass，18项通过、0问题、0警告。
  stateVersion16，提交与审计均committed；activeOperation/pendingDispatch为空。
- 机器审核不是事实语义或人工批准：Script approval仍pending，Research仍approved/complete，所有人工审批与此前相同。
  上游、非Script流水线、讲稿正文、5份登记研究文件和其他Episode均核验未变；预算使用/保留与模型调用均0。
  没有新增配音、分镜或本期渲染。可读稿仍 `outputs/topic-discovery-20261022.qXumz5/HARNESS-SCRIPT-v2.md`。
- 证据：同目录 `script-review-focused-20261023.log`、`script-review-full-verify-20261023.log`、
  `script-review-dependency-audit-20261023.log`、`HARNESS-SCRIPT-REVIEW-*-20261023.json`。
  `run-harness-script-review-20261023.mjs` 已消费，不能整份重跑；当前等待用户审阅讲稿，未经确认不批准或继续制作。
- machine_status=local_full_verification_and_script_review_passed；technical_status=local_script_review_entry_verified；
  business_acceptance_status=script_human_approval_pending；release_status=uncommitted_no_video_release。

## 先前阶段：研究批准与讲稿入库（v88历史）

- 用户明确选择允许临时启用本机零费用Operator入口，已披露其技术上为全Studio零费用写权限；仅本期操作。
  2026-10-22T10:06:33Z正常HTTP session/CSRF完成Research精确批准及已批准Worker收尾，无启动全局恢复。
  未挪用公开选题身份，凭据只在进程内，服务在研究收尾后立即关闭；随后端口连接返回ECONNREFUSED。
- Episode `agent-harness-manual-2cb40075fda50bb9`：Research仍v3，approved、步骤complete；原hash/report/pack/sourceDocs不变。
  本地完整讲稿候选v2经现成CLI预览并导入，登记为**正式脚本v1**，正文与候选v2一致；两种版本号含义不同。
- 导入正常committed、0警告、审计committed、stateVersion14。脚本Gate hash
  `ff86a897be8b3c6f3b7a2fa4c8b65aa610f252c64a9b3b6bc8a2c4a19e1c0093`；磁盘正文SHA
  `8d7e864b727d0b7e5857084c00268cedaf16d51315e76dc72328eab6cdf385f6`。
  候选SHA仍`5d628fcf4e1cc9ca2ab79424500f197bd88d59e8e7fdb5a215d94a63c98ed841`。
- **当前未完成机器审核**：Script步骤字段为waiting_approval，但review=not_started、人审pending，因此不能称可批准或已通过。
  既有recheckGateReview缺通用安全CLI/HTTP接线；Script Worker外层会先阻止未批准步骤，且固定付费manifest要求正预算。
  未通过扩预算/DI/直调底层函数绕过。若后续补零费用审核入口，需单独明确R3范围与验证，不把入库当审核。
- operator、审批文件完整性、本地脚本入库专项62/62、0fail/0skip。真实操作后核对研究文件/非目标Episode字节SHA不变，
  脚本磁盘正文与候选一致，activeOperation为空，模型使用/保留调用及费用0。无配音/分镜/渲染或Git操作。
- 证据位于`outputs/topic-discovery-20261022.qXumz5/`：`HARNESS-REGISTRATION-BEFORE.json`、
  `HARNESS-RESEARCH-REGISTERED.json`、`HARNESS-TEMP-OPERATOR-CLOSED.json`、`HARNESS-SCRIPT-IMPORT-PREVIEW.json`、
  `HARNESS-SCRIPT-IMPORTED.json`、`HARNESS-REGISTRATION-AFTER.json`。`register-research-approval-and-script.mjs`已执行，勿重跑。
- 可读讲稿仍`HARNESS-SCRIPT-v2.md`，四章12节、约8分半仅估时；用户尚未批准脚本。下一步是零费用机器审核入口或稿件修改，
  不继续分镜；本轮未修改运行源码、未commit/push/merge。前轮1854项全量验证不替代此次稿件或未来入口验证。

## 先前阶段：Harness完整讲稿（v87历史）

- 用户原话“1，批准这版研究，继续写完整讲稿”明确批准Research v3内容；不重新询问主题、案例或大纲。
  研究版本/hash/report保持v86记录一致，但**人类明确批准与系统登记分开**：Episode仍为research waiting_approval、
  approval pending，script pending。未手写Episode、未复用公开选题凭据、未新建宽权限身份。
- 现有正式审批API需要Operator session/CSRF；本机未配置Operator，也没有Studio服务。公开选题身份仅支持
  collector/import/trend，不可挪用审批。已向用户询问是否允许新临时零费用Operator，其技术权限为全Studio零费用写，
  不是仅本期凭据；拟关闭启动恢复、只操作本期、完成即关闭。目前未收到这项额外授权。
- 不阻塞已获授权的本地编写：完整讲稿v2，四章12节，正文2355汉字、2460有效字符（含英文）；编辑估时510秒，
  不代表已配音。口播与短屏显/插画方向分开，开场先主题和导航，采购案例贯穿，章节之后绑定实际音频、不等分。
- 本地候选`outputs/topic-discovery-20261022.qXumz5/HARNESS-SCRIPT-CANDIDATE-v2.json`，SHA
  `5d628fcf4e1cc9ca2ab79424500f197bd88d59e8e7fdb5a215d94a63c98ed841`；可读稿同目录`HARNESS-SCRIPT-v2.md`。
  `HARNESS-SCRIPT-PREFLIGHT-v2.json`记录合同、两份登记研究文件字节/SHA、v3绑定、7条主张覆盖均通过；
  现有quality计数含编辑摘要2518字/510秒=4.937，范围合规。这是只读离线预检，不是正式机器Gate。
- 独立语义复核v2无阻断；v1保留。已修Loop按需工具与结束出口、超时只是一种可能的视觉限定、
  超预算须有权调整约束再重审、提交时核对获批条件；不把框架功能讲成采购默认保证或客户实测。
- 本轮未修改运行源码；未导入讲稿、未配音/分镜/渲染/付费、未commit/push。旧golden-001 SHA仍
  `462f42c934c82011df1363d89ca17b77b9960e79e606fa40d5d4150b4e0f1a28`，本期activeOperation空、预算使用0。
- 下一步等用户选择临时入口。获准后先按精确绑定登记Research批准，再调用已批准research-agent收尾
  （ready→complete，不抓新资料、不造v4），使用现有`import-local-script.mjs`预览并导入v2，随后独立机器审核、
  停在脚本人审。未授权就只交付文件，不下调调用、造grant或旁路写状态。详见本地`HARNESS-SCRIPT-SCOPE-v1.md`。

## 先前阶段：零付费 Research 入口（v86历史）

- 用户已确认精确选题快照及零付费Research实现路线。2026-10-22T09:04:09.699Z通过正常人工选择CLI提交，
  Episode为`agent-harness-manual-2cb40075fda50bb9`。旧golden-001不变，五个人审仍pending。
- 本轮新增专用本地请求/CLI/服务，复用真实Kernel与证据CAS导入；严格绑定Episode、版本、快照、候选原始SHA，
  只允许0 calls/$0，不自动批准Research。旧无授权CLI继续fail closed。
- 两项P1（import提前释放锁、CAS已成功后授权过期误报失败）已修，并通过9项临时root真实Kernel回归；
  底层Run防绕过硬化已完成，最终专项75/75通过。首次全量1847项/1841通过/6失败，均为
  bundled Python3.12.14与仓库锁3.12.13不匹配；切换已验证的锁定环境后相关30/30通过，
  完整verify重跑1854/1854通过、0失败/0跳过，含回滚及三类合成渲染检查。
  实现绑定为v19、244路径、`d3df03a74c53dbd59c474e51a2bd017850fe485bc007d87e11608598914ecd1e`，
  eligible仍false；依赖安全扫描无已知漏洞。本地通过不代表新分支hosted CI或已合并。
- 生产通过新增正常CLI完成run→证据import→run：Research v3，9份一手文档/2家组织、7条主张、6条跨来源，
  关键类别无缺口。机器审核`review-research-v3-1-2026-10-22T09-34-50-480Z`为pass/deterministic，
  内容哈希`46060a70482a17ef185ab6d23a62eaa316e3b4d4f47ce6590756971a88a3cea5`，状态waiting_approval。
  机器结构检查不是事实语义的人审，也不是采购系统实测；所有采购示例都保留说明性边界。
- 本机9个原页直抓均因unsafe-network-target停止；verified证据来自本轮此前公开原文阅读及独立核对，
  经受控证据批次导入，未绕过网络保护、未把抓取失败说成成功。来源access状态如实保留needs_assist。
- 正式批次`harness-primary-research-20261022-v1`已消费；不要重放。5份登记文件逐一核对字节/SHA通过，
  无activeOperation，模型调用0、预算使用0；脚本仍pending。确认页`HARNESS-RESEARCH-APPROVAL-v1.md`及
  `HARNESS-RESEARCH-FINAL-AUDIT.json`位于outputs/topic-discovery-20261022.qXumz5。
- 本轮没有生成脚本或本期视频，没有付费、commit/push；等待用户针对上述Research版本决定，不能自动批准。
- 下方v84“未创建Episode/待快照确认”描述保留为历史，不是当前停点。

## 先前阶段：按workflow发现新视频选题

- 用户已确认Agent Harness、企业采购案例和四章大纲，授权补齐登记/研究证据。原大纲v1不覆盖，
  本轮可读材料为 `outputs/topic-discovery-20261022.qXumz5/HARNESS-RESEARCH-REVIEW.md`。
- R1仅新增taxonomy概念及3项合成测试，不改打分/来源/旧概念/权限代码；先红后绿，11文件
  聚焦117/117通过、0skip，独立只读复核通过。裸Harness和产品名不自动映射；旧62条信号
  无自动新增Harness映射。没有以旧main CI替代本次验证。
- 一个已注册Leo作者的近期运行规则/权限原作经纯校验和正常生产CLI导入，批次
  `assisted-harness-runtime-20261022-0900`已消费不可重放。当前Radar为
  `trend-2026-10-22T08-54-46-629Z`，63总信号、近30天11条、0正式候选。
  Harness近14天0组、30天1组，score34，保持观察池；只支持窄子机制，不是完整主题热点。
  本补充批次扫描1作者，24 notScanned；此前扩源历史仍保留，不声称本批完整扫描25作者。
- 只读人工选择预览成功，snapshotHash为
  `5077bd8ffd99deabc6bf97e952d3bea1465b86a621e1dda4acacc087b1e00a89`。
  docs21要求此精确快照展示后确认；当前未创建Episode、未签发人工选择授权。
- 离线研究草案9份一手来源、2家组织、7条主张，其中6条跨来源，覆盖全部关键类别；
  Deep Agents架构锁上游SHA b4ac8829692785a221150658401ae558f4bff3f3。
  两种官方实现边界不同，因此使用工作定义；不外推为全球无标准。采购仅说明性例子。
  schema和纯数量检查通过不代表正式Research机器审核或人审；草案episodeId为空、不能直接导入。
- 独立确认 `run-research.mjs` / `import-research-evidence.mjs` 缺生产Capability接线，
  不能复用发现/选题grant、DI、造Authority或直写状态。尚未运行Research；后续若补专用
  零付费入口需用户另行授权，不自动启动宽权限HTTP服务。无脚本生成、渲染或commit/push。
- 导入与预览前后旧Episode内容哈希一致、付费0；详细不可覆盖产物在当前outputs证据目录。
- 最新偏好校正：用户不要过于算法化，举Harness、Loop为例，要求能沿业务逻辑讲清。
  MoE/推测解码/Reranker不再作为本期推荐。最新备选为Agent Harness（推荐）、Agent Loop、
  Durable Execution，分别以业务任务的运行支撑、行动反馈循环、暂停恢复为主线。
  官方资料与独立概念边界复核已完成；只是选题备选，没有新的热度准入证明或生产审批。
  详见本地 `outputs/topic-discovery-20261022.qXumz5/AGENT-MECHANISM-CANDIDATES.md`。
- 上轮偏好解释（已被纠正）：用户否决PDF/文档理解及Agent评测综合方向，要求具体AI技术，已选择由Agent
  跨模型原理与应用算法重新筛3题。本轮一手资料核对后给出MoE（推荐）、推测解码、
  Reranker；它们是技术备选，不冒充热点门槛已通过。详见本地证据目录
  `outputs/topic-discovery-20261022.qXumz5/CONCRETE-TECH-CANDIDATES.md`。
  本轮只读公开研究和R0状态文档，不重复导入、不改变来源/taxonomy/阈值/运行代码；
  没有新Episode、Gate批准、付费调用、渲染或Git提交。下方PDF等为已否决的历史备选。
- Zhengjiazhi 要求使用最新main制作新视频，先由Agent发现候选，再由用户选择。
  初始阶段不选题；目前已按上文确认主题，但仍未创建Episode或批准任何生产Gate。
- 远端main已核实为 `000a9901779a71f0670d5fa8e2ccf17f0ffd8c9e`，PR #8已合并，
  [合并后CI](https://github.com/zhengjiazhi929-commits/ai-concept-studio/actions/runs/39734687204)成功。
  复用干净的附属工作树，从该main建立本地分支 `codex/video-discovery-20261022`；
  不改旧脏目录，也未推送新分支。本轮准备没有修改运行代码。
- 已核对Node24.19.0、pnpm11.19.0和公开发现CLI。18个启用来源中17个入口是固定作品，
  读取入口不代表已扫描作者近期新作；后续须按新v2任务核对公开原作品。
- 当前checkout保留的52条旧信号已过期，不能复用旧formal候选。执行时生成新任务并
  重算Radar，保留历史数据，不降低正式候选门槛。
- 用户已选择延续AI技术分享。已初始化仅限免费公开发现的本地私有身份，运行生产
  setup/discover/assisted-import/Radar入口；paidModelCalls=0，未启动生产HTTP服务。
- 第一轮taskId为 `discovery-2026-10-22T06-48-16-385Z`，近30天窗口为
  2026-09-22T06:48:16.385Z至2026-10-22T06:48:16.385Z。18来源均尝试核查：
  6位有近期原作品证据、6位访问受限、6位未核验；这是局部公开检索，不是完整账号扫描。
- v2批次 `assisted-ai-education-20261022-0655` 经纯校验和正常授权导入成功：
  16条原页元数据观察，5条接受为概念信号、11条未知概念待复核，新增5条信号。
  缺少账号链接的记录明确保留弱署名身份；未猜测互动指标或使用缓存相对日期。
- Radar `trend-2026-10-22T06-55-30-920Z` 为 `needs_more_evidence`：
  0正式候选。当前窗口仅5条已映射信号；旧52条未作为当前热度。
  Agentic Coding已由系统排重；上下文工程/记忆另按用户成片历史排除。
  唯一尚未制作的已映射方向Agent安全只有1来源且是事件新闻，不能直接立项。
- 用户随后选择扩大公开来源继续筛选。R1配置扩展恰新增7个技术作者，当前25源；
  旧18个来源、权重、taxonomy、评分门槛和运行代码不变。6个新B站账号使用原页账号
  绑定，Hector保留固定原作+署名弱身份；官方OceanBase账号不作为独立创作者加入。
- 扩源taskId为 `discovery-2026-10-22T07-11-55-674Z`，窗口至2026-10-22T07:11:55.674Z。
  新批次 `assisted-expanded-ai-20261022-0716` 纯验证后由正常生产CLI导入一次：
  25条观察（原16+新9），10accepted、15pending，新增5信号、更新5信号。
  25来源中13verified、6blocked、6unverified；这是有限公开核验，非完整近期作品扫描。
- 上轮Radar `trend-2026-10-22T07-16-47-826Z` 为 `needs_more_evidence`、0正式候选。
  近30天10条信号；安全2来源组，评测/RAG/多Agent/任务成本各1组，均未过门槛。
  任务成本仅新闻事件证据；AI超的宽映射已收窄pending。OCR和KV Cache不强映射相邻概念。
- 上轮编辑备选（已被用户要求更换）：PDF/OCR与文档理解、Agent结果评测、权限/沙箱。它们不是
  热点达标候选；用户另行确认人工编辑选题路线前，不立项、不批准Research、不渲染。
  官方项目证明资料存在，不替代独立创作者热度；Sean原页列WakuAgent参演，只算一组，
  未确认付费赞助；当前引擎不保留eventCluster，不能声称系统已按事件去重。
- 新来源契约测试先红再绿，8文件聚焦69/69通过，配置和测试独立只读复核通过，
  diff检查通过；未运行本轮全量CI，不沿用main旧CI宣称当前未提交修改通过。
- 证据目录 `outputs/topic-discovery-20261022.qXumz5/` 保存两轮批次、研究、纯预检和
  生产CLI不可覆盖报告，详见EXPANDED-REPORT.md。Episode前后哈希不变、paidModelCalls=0。
  新来源配置/测试尚未commit/push；collector/trend运行数据不作为源码交付。
- 当前checkout的Episode历史不涵盖其他工作树已制作的Agent Skill、上下文工程与
  Agent记忆，候选展示前结合已知成片排重，不能伪造Episode记录。
- machine_status=expanded_discovery_import_radar_passed；technical_status=needs_more_evidence；
  business_acceptance_status=harness_topic_procurement_case_confirmed_outline_pending；
  release_status=no_episode_registration_or_video_release。

## 2026-10-22 PR #8 交付记录（已合并；不是新片审批）

- Zhengjiazhi 已确认章节导航预览符合预期，并选择“合并 PR #8”。该授权取代下方
  历史记录中的“未授权合并”和“视觉待确认”；不是新的完整视频、生产 Gate、部署
  或发布批准。不调用付费服务，不渲染新整片，不改真实 Episode 或原工作树。
- 本轮仅更新这份状态记录，运行代码、依赖、测试和视觉源文件保持已验收版本。
  开始时隔离工作树干净，分支为 `codex/verified-system-delivery-20261020`，
  HEAD 为 `8c0333e99032d9c297c12e3def50e64c0c6a1526`，远端 main 仍为
  `0c2b1cdc993a8c9492ab5a091573d673ac60503d`。
- 上述精确 HEAD 的 [PR CI](https://github.com/zhengjiazhi929-commits/ai-concept-studio/actions/runs/39559533590)
  和 [push CI](https://github.com/zhengjiazhi929-commits/ai-concept-studio/actions/runs/39559529475)
  均已成功。本地完整验证为1812/1812；PR CI为1812项中1807通过、0失败、
  5项Mac启动器测试因Linux无zsh跳过，这5项已在本地通过。
- 实现仍为 `agent-control-release-v18`，236个路径，SHA-256
  `416af8a736645b04188cf350c0a3348fa7d03179f034b25e9a2c282c52929732`。
  本轮文档更新不提升实现版本或准入级别，`admission.eligible=false` 与 fixed fallback 保持。
- 合并按R3交付边界执行：文档差异、链接及秘密检查通过；确认新增文档提交的精确
  HEAD CI成功后，使用匹配HEAD的普通合并，不绕过保护，不删除分支。实际合并时间、
  merge SHA与合并后CI以 [PR #8](https://github.com/zhengjiazhi929-commits/ai-concept-studio/pull/8)
  和GitHub main为事实来源，不以旧绿色记录替代新提交验证。
- 若需回退，以新的反向提交撤销本次合并并重新验证；不得reset原工作树、覆盖
  已有媒体或撤销人工生产记录。原成片保持不变，本轮没有新的整片验收。
- machine_status=runtime_verified_document_head_requires_own_ci；
  technical_status=review_findings_remediated；
  business_acceptance_status=chapter_navigation_preview_accepted；
  release_status=code_merge_authorized_live_state_in_pr8。

## 2026-10-21 PR审查整改历史（不是当前授权边界）

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
