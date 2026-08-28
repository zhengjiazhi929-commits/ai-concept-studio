# AI 技术视频图标系统 v4

这套系统解决“相同 AI 技术概念每次都画成同一个图标”的问题。它不是图标墙素材库，也不允许 Storyboard 从一个好看的图标开始倒推内容。

当前状态：28 个语义映射、几何、状态与动效注册表保持 `approved-production-v1`；当前工作树的展示边界候选升级为 `ai-tech-icon-contract-v4`，须经新 MP4 视觉确认后才能成为生产默认。Zhengjiazhi 已于 2026-08-26 接受 `ai-tech-icon-system-review-v002` 的注册图标方向；后续相同 `conceptKind` 必须复用同一注册图标，不能临时改画。v4 不改变这 28 个映射，而是把图标的语义参与方式收敛为“关系节点、近距归属说明、专门焦点”三类，并禁止造成重复表达和因果断裂的远端边栏。2026-08-27 的最新 Git 决策允许把本轮视觉整改的精确任务代码、文档、测试和必要运行时资产选择性提交并推送到 `codex/agent-production-pipeline`；仍禁止创建 PR、merge 或把代码同步误报为完整视觉验收。

2026-08-26 更新：Zhengjiazhi 已确认 v002 的注册几何视觉方向；图标注册表晋升为 `approved-production-v1`，稳定可见面积品牌水印 v013 同步晋升为默认生产 profile。批准记录的可执行真源是 `AI_TECH_ICON_REGISTRY_APPROVAL`；任何后续几何或 motion 变化都必须升版本并重新确认。专门独立图标演示/焦点布局的实际成片效果仍须通过新 MP4 视觉确认，不能用旧联系表代替。

可执行真源：

- 语义、尺寸、状态和动效合同：`studio/src/shared/ai-tech-icon-contract.mjs`
- 长视频图标用途、数量与“不逐卡配图标”规则：`studio/src/shared/editorial-visual-policy.mjs`
- 纯文字信息卡的文案宽度、分行与无图标槽布局：`studio/src/video/components/visual-system-v1/content-layout.mjs`
- 稳定语义映射：`studio/src/video/components/visual-system-v1/icons/registry.mjs`
- 统一矢量几何：`studio/src/video/components/visual-system-v1/icons/geometry.mjs`
- Remotion 组件：`studio/src/video/components/visual-system-v1/icons/ai-tech-icon.jsx`
- 专测：`studio/tests/ai-tech-icon-contract.test.mjs`、`studio/tests/visual-system-v1-ai-tech-icons.test.mjs`

## 1. 使用边界

Storyboard 的独立图标计划只声明 `conceptKind`，不能声明 `canonicalIconId`、SVG path、颜色、线宽或具体像素尺寸。`conceptKind` 不属于信息卡 node；resolver/renderer 只把独立开放图解对象或专门焦点稳定映射为注册图标：

```text
conceptKind → canonicalIconId → geometry + token roles + motion recipe
```

不能根据中文标题猜图标。未知 `conceptKind` 必须 fail closed；信息卡 node 固定使用 `none`。图标只有在确实帮助观众识别对象、状态或动作时才允许出现，不能重复标题，也不能为了填空白形成图标墙。每个长视频独立图标还必须声明 `semanticObjectId`、`anchorId`、`purpose: "semantic-anchor" | "state-proof" | "interaction-cue"`、`participation: "graph-node" | "owned-callout" | "dedicated-focus"`，并选择 `presentation: "open-diagram-symbol" | "standalone-focus"`；缺少任一项都不渲染。同一 `semanticObjectId` 只能有一个主表现，不能同时保留同名文字节点和另一处图标。

`graph-node` 直接替换对应开放图解文字节点，继承其稳定布局位置和全部入射/出射关系线；文字标题与说明在图标节点内部排版，图标和标签揭示时间差不得超过 1 帧。稳定布局锚点只负责占位，实际 DOM 与连接线必须共同消费由注册图标尺寸、统一字号、间距和 padding 测出的紧致可见几何；测量结果放不进锚点时 fail closed，不能缩字或裁切。`owned-callout` 必须显式声明 owner，距 owner 最多 48px，并使用清楚的归属线；`dedicated-focus` 必须使用真正预留独立区域的 `dedicated-icon-focus` 布局。远端左右 rail、无 owner 漂浮、同时保留同名节点都直接 fail closed；任何模式都禁止用 clamp、缩小文字、覆盖卡片、压住边框或穿过箭头来强行显示。

关系入场采用 `connector-arrow-first`：已有 source 可先向预留端点绘制关系，新 target 的图标与文字在最后一条必要入边的箭头抵达时同步显现；新 source 则必须与出边同帧出现。同阶段两跳以上关系按拓扑波次执行，例如 `Skill → Agent → Tool` 必须先建立 Agent，再从 Agent 画向 Tool。没有明确入口的循环关系、提前漂浮的 target、从未建立的中间节点发出的线都直接 fail closed。

## 2. 第一批 28 个稳定语义

| 分类 | conceptKind | canonicalIconId | 解释任务 |
|---|---|---|---|
| 内容与输入 | `prompt` | `prompt-bubble` | 提示词或自然语言输入 |
| 内容与输入 | `document` | `document-sheet` | 文档、说明或文本产物 |
| 内容与输入 | `image` | `image-frame` | 图像输入或输出 |
| 内容与输入 | `audio` | `audio-wave` | 语音和音频处理 |
| 内容与输入 | `video` | `video-player` | 视频输入、生成或播放 |
| 内容与输入 | `table-data` | `table-grid` | 行列与结构化记录 |
| 数据与知识 | `database` | `database-stack` | 持久化数据源或查询目标 |
| 数据与知识 | `knowledge-base` | `knowledge-books` | 可检索知识集合 |
| 数据与知识 | `search-retrieval` | `retrieval-search` | 搜索、召回与检索 |
| 数据与知识 | `vector-embedding` | `vector-points` | 向量、相似度与嵌入空间 |
| 数据与知识 | `context-window` | `context-window` | 当前模型可读取范围 |
| 数据与知识 | `memory` | `memory-chip` | 短期或长期记忆 |
| Agent 与运行时 | `ai-model` | `model-layers` | 模型推理层，不画人物或机器人 |
| Agent 与运行时 | `agent` | `agent-node` | 协调上下游能力的执行节点 |
| Agent 与运行时 | `tool` | `tool-wrench` | 可执行动作或外部能力 |
| Agent 与运行时 | `api` | `api-brackets` | 程序接口和请求边界 |
| Agent 与运行时 | `mcp` | `mcp-bridge` | MCP 协议连接 |
| Agent 与运行时 | `workflow` | `workflow-nodes` | 有顺序和依赖的工作流 |
| Agent 与运行时 | `routing` | `routing-branch` | 一次判断产生不同结果 |
| Agent 与运行时 | `parallel-execution` | `parallel-lanes` | 多任务并行推进 |
| Agent 与运行时 | `retry` | `retry-cycle` | 受控重试而非无限循环 |
| 治理与状态 | `verified-success` | `verified-status-mark` | 可验证条件全部通过，复用共享方形状态对号 |
| 治理与状态 | `warning` | `warning-triangle` | 需要注意但尚未失败 |
| 治理与状态 | `failure` | `failure-cross` | 已失败或被阻断 |
| 治理与状态 | `human-approval` | `human-approval-gate` | 人工决定 Gate，不画人物、不另画一套对号 |
| 治理与状态 | `permission` | `permission-lock` | 访问权限和执行边界 |
| 治理与状态 | `audit-log` | `audit-clipboard` | 可追溯审核记录 |
| 治理与状态 | `version-history` | `version-history` | 版本演进、历史和回退 |

## 3. 统一视觉合同

- 所有图标使用 `64×64` viewBox，光学安全内边距 8，默认线宽 3.5。
- 使用扁平二维轮廓、圆端点和圆连接；每个图标最多 6 个必要几何原语。
- 几何文件不包含原始色值，只声明 `primary`、`secondary`、`surface` 槽位；renderer 再解析 visual-system 的语义颜色 token。
- 默认主色为正文色，辅助色为薄荷强调；紫色只用于人工确认，成功、警告和错误色只用于真实状态。
- 禁止 emoji、Unicode 状态符号、场景私有 SVG 图标、伪 3D、厚重阴影和装饰渐变。
- 信息卡内容模式固定为 `text-only`，每张信息卡的图标预算为 0；不得在卡片标题、正文或预留槽位中嵌入图标。
- 正式成片中的 AI 技术注册图标只允许 `open-diagram-symbol` 或 `standalone-focus`：前者是真正承担对象、动作或交互识别的独立开放图解对象，后者是专门预留区域的单一图标焦点。信息卡内部的图标预算始终为 0。
- 开放图解中的流程锚点、决策点、输出和关系线属于语法布局的结构几何，不是 AI 技术图标，也不能退化成标题旁的装饰符号。图标只能通过独立图标计划和共享注册表进入画面。
- 图标联系表、关键片段和既有输出只用于历史评审与回归，不是生产构图模板，也不能用其旧位置恢复卡片图标。
- 图标必须保持辅助层级：文字尺寸、对比度和信息面积高于图标，图标不能替代大标题、解释文字、关系图或证据。
- 是否使用信息卡仍由语义职责和层级决定，不能简化成整屏“全用卡片”或“全不用卡片”；一旦对象选择信息卡，它就保持纯文字。需要解释过程、关系、分支或状态时，优先穿插 `mixed-diagram` / `open-diagram` 图解，而不是继续增加图标。
- 同一 `semanticGroupId + semanticRole + visualHierarchyLevel` cohort 内的对象必须保持相同承载方式；这保证同组一致，但不要求不同语义组或整屏机械地全部套卡片。
- 图标所在关系路径还受连通拓扑一致性约束：一条未声明语义子组边界的连续流程只允许一种承载方式；`graph-node` 图标继承 anchor 节点的开放图解身份，不能让相邻主流程节点一部分有卡片、一部分无卡片。
- 不同承载方式只有在关系明确声明 `semantic-subgroup-transition + surface-change + rationale` 时才能相连；互不连接的子图或独立结果容器仍可不同，避免把规则误写成全屏绝对化。
- 独立图标必须消费统一的尺寸角色、注册几何和安全槽，不得按场景临时改颜色、比例、线宽、位置算法或嵌入方式。
- 注册图标不得用作卡片徽章、贴边附件、标题前缀、节点装饰或结果卡注释；需要展示图标时必须切换到为图标预留独立空间的构图。

尺寸只允许使用四种角色：

- `inline = 36px`：只用于旧图标审阅联系表的小号独立展示，正式成片不得嵌入卡片文字；
- `support = 56px`：开放图解中的独立语义图标，不得依附卡片边框、标题或正文；
- `longform-support = 88px`：仅用于横版长视频明确预留的大型图解节点；不得进入远端边栏，也不得作为卡片 owner、徽章或附件；
- `focus = 104px`：单一图标焦点布局中的主概念，每屏最多一个。

可见比例还需同时满足：

- 正式成片不使用行内图标；`support` 与 `longform-support` 独立图标不能侵入标题或信息卡主阅读区；
- `focus` 只用于整屏唯一概念锚点，不能与多张卡片或大段说明文字竞争；
- 图标、文字和容器的缩放只能消费共享尺寸角色和布局测量结果，禁止场景临时放大图标、缩小文字或改变线宽。

## 4. 动效合同

组件接收 Remotion frame 推导出的 `progress`，不使用 CSS animation、transition、计时器或随机数。默认 16 帧进入：整体轻微上移淡入后绘制轮廓，`progress >= 1` 后精确落稳并保持不变。

大标题必须至少领先 12 帧。除品牌水印外，图标不得持续循环；同时运动的图标仍计入全局最多三个运动对象的预算。

推荐调用：

```jsx
<VisualSystemV1StandaloneIcon
  conceptKind="search-retrieval"
  presentation="standalone-focus"
  sizeRole="focus"
  progress={progress}
  style={{left, top}}
/>
```

信息卡不调用该组件，也不为图标预留贴边空间。开放图解只有在图标本身能独立增强对象、动作或交互识别时才创建 `open-diagram-symbol` 计划；镜头明确预留焦点区域时才创建 `standalone-focus` 计划；未知值直接抛出合同错误。

`open-diagram-symbol` 在调用组件前必须先决定它是 `graph-node` 还是 `owned-callout`。前者占用被替换节点的真实关系位置并成为连接线端点；后者只能进入 owner 周围 48px 内的受控槽位，并绘制归属线。横版长视频禁止 `open-diagram-rail`、`left-rail`、`right-rail` 等远端边栏摆放。`standalone-focus` 必须使用 `dedicated-icon-focus` 专用布局；安全槽不能把普通卡片镜头自动改造成图标贴边或焦点布局。

## 5. 对号规则

`verified-success → verified-status-mark → VisualSystemV1StatusMark` 是唯一成功对号路径。它基于 Zhengjiazhi 指定的 [Uiverse / cssbuttons-io / short-shrimp-54](https://uiverse.io/cssbuttons-io/short-shrimp-54) 视觉方向做了 Remotion 帧驱动重实现；运行时不复制网页 CSS 动画，不使用 Unicode、emoji 或场景私有 SVG 对号。这个注册关系只定义“需要专门展示成功图标时画哪一个”，不授权把对号贴到结果卡上。

共享状态对号只允许两种语义动效：

- `quiet`：普通清单逐项完成，用约 6 帧克制绘制后稳定保持；
- `celebrate`：只用于一次关键最终验收，用约 18 帧单次 jelly 建立后稳定保持，不能循环。

人工 Gate 图标不再内置小对号；审计清单改用项目圆点。任何专门的成功图标演示都必须组合 `VisualSystemV1StatusMark`，因此同一视频不会再出现圆形对号、手写对号和方形对号三套视觉。对号只能在真实验收项全部完成、且镜头明确采用独立成功状态焦点布局时出现，禁止无证据成功态。

对号与数据库、路由、模型、工具等其他注册图标处于同一层级，没有“结果完成就自动追加”的特殊地位。它不得作为卡片徽章、贴边附件、标题前缀或结果卡注释；若确实需要展示，必须单独设计成功状态图标演示/焦点镜头。

当前长片 S18 不显示对号。S18 只通过完整边框信息卡、正交关系和文字层级表达最终治理结论；不得再把对号作为结果卡注释、卡片外贴边附件或结尾徽章加回去。

## 6. 审批与版本门禁

1. 先生成 28 图标静态联系表：注册尺寸、默认色和状态色；它只验证注册图标，不定义生产摆放方式。
2. 再生成成功、检索、路由、模型调用、MCP、人工确认等动态图标关键片段。
3. 对真实 PNG/MP4 检查语义对应、辨识度、文字比例、裁切、重叠、颜色和最终稳定帧。
4. Zhengjiazhi 确认后，注册表状态和几何版本才能晋升；不符合时生成不可覆盖的新候选。
5. 已批准的 `conceptKind → canonicalIconId` 在同一 registry major version 内不可改变。几何或 motion 改动必须升版本并重新确认。
6. 最终接入成片时，所有图标输出 `data-ai-tech-icon-*` 属性并进入代表帧与 MP4 QA；自动专测通过不能替代人工视觉确认。

## 7. 品牌水印默认 profile

已批准默认 profile 为 `approved-v013-stable-footprint`。它保留 v012 的 120 帧、120×120 RGBA 和四段旋转内容，但按每帧 `alpha >= 16` 的真实可见框做等比缩放与居中：可见最长边稳定在 108±2px，中心相对 60/60 的误差不超过 1px。组件外框尺寸仍为 120px，右上角边距仍为 40px，不改变品牌安全区。

兼容规则：

- 不传 `profile` 时，`VisualSystemV1AiWatermark` 与 `VisualSystemV1WideBrandLayer` 默认读取 `approved-v013-stable-footprint`；
- 旧资产 `ai-watermark-v012` 完整保留，需要回看旧视觉时必须显式传 `profile="approved-v012"`；
- 旧候选名 `review-v013-stable-footprint` 仅作为向后兼容别名解析到已批准 v013，不能再据此判断审批状态；
- v013 manifest 必须同时声明 `approved=true`、`reviewOnly=false`、审批方向与 canonical profile；
- 后续几何、尺寸或节奏调整必须生成新版本，不能覆盖 v012、v013 或任何既有成片。

长片可以显式使用 `VisualSystemV1WideBrandLayer tone="quiet"`，当前 quiet opacity 为 `0.76`。tone 只降低视觉权重，不改变 v013 profile、120×120 尺寸、`top=40/right=40` 位置、120 帧循环、可见 footprint 或右上 200px 品牌安全区；其他 composition 不传 tone 时仍为 `standard=1.0`。每个正式片段仍必须恰好包含一个品牌层。

可执行真源：`studio/src/video/components/visual-system-v1/ai-watermark.mjs`、`studio/src/video/components/visual-system-v1/brand-layer.jsx`、`studio/public/assets/visual-system-v1/ai-watermark-v013/manifest.json`。
