# AI 技术视频图标系统 v2

这套系统解决“相同 AI 技术概念每次都画成同一个图标”的问题。它不是图标墙素材库，也不允许 Storyboard 从一个好看的图标开始倒推内容。

当前状态：28 个语义映射、几何、状态与动效注册表保持 `approved-production-v1`；展示边界升级为 `ai-tech-icon-contract-v2`。Zhengjiazhi 已于 2026-08-26 接受 `ai-tech-icon-system-review-v002` 的注册图标方向；后续相同 `conceptKind` 必须复用同一注册图标，不能临时改画。v2 不改变这 28 个映射，而是明确正式成片中的信息卡纯文字、图标只在卡片外独立展示。2026-08-27 的最新 Git 决策允许把本轮视觉整改的精确任务代码、文档、测试和必要运行时资产选择性提交并推送到 `codex/agent-production-pipeline`；仍禁止创建 PR、merge 或把该代码同步误报为完整 v006 视觉验收。

2026-08-26 更新：Zhengjiazhi 已确认 v002 的注册几何视觉方向；图标注册表晋升为 `approved-production-v1`，稳定可见面积品牌水印 v013 同步晋升为默认生产 profile。批准记录的可执行真源是 `AI_TECH_ICON_REGISTRY_APPROVAL`；任何后续几何或 motion 变化都必须升版本并重新确认。卡片外独立展示的实际成片效果仍须通过新 MP4 视觉确认，不能用旧联系表代替。

可执行真源：

- 语义、尺寸、状态和动效合同：`studio/src/shared/ai-tech-icon-contract.mjs`
- 长视频图标用途、数量与“不逐卡配图标”规则：`studio/src/shared/editorial-visual-policy.mjs`
- 纯文字信息卡的文案宽度、分行与无图标槽布局：`studio/src/video/components/visual-system-v1/content-layout.mjs`
- 稳定语义映射：`studio/src/video/components/visual-system-v1/icons/registry.mjs`
- 统一矢量几何：`studio/src/video/components/visual-system-v1/icons/geometry.mjs`
- Remotion 组件：`studio/src/video/components/visual-system-v1/icons/ai-tech-icon.jsx`
- 专测：`studio/tests/ai-tech-icon-contract.test.mjs`、`studio/tests/visual-system-v1-ai-tech-icons.test.mjs`

## 1. 使用边界

Storyboard 的独立图标计划只声明 `conceptKind`，不能声明 `canonicalIconId`、SVG path、颜色、线宽或具体像素尺寸。`conceptKind` 不属于信息卡 node；resolver/renderer 才把卡片外的语义图标稳定映射为注册图标：

```text
conceptKind → canonicalIconId → geometry + token roles + motion recipe
```

不能根据中文标题猜图标。未知 `conceptKind` 必须 fail closed；信息卡 node 固定使用 `none`。图标只有在能帮助识别对象、状态或动作时才允许出现，不能重复标题，也不能为了填空白形成图标墙。每个长视频独立图标还必须声明 `anchorId`、`purpose: "semantic-anchor" | "state-proof" | "interaction-cue"`，并选择 `presentation: "standalone-focus" | "open-diagram-symbol"`；缺少任一项都不渲染。

图标的展示位置也采用 fail closed：renderer 只能从锚点右、左、上、下的候选槽位中选择完整位于安全区内，且与全部节点和连线保持净空的位置。没有安全槽时返回 `render: false`；禁止用 clamp、缩小文字、覆盖卡片、压住边框或穿过箭头的方式强行显示图标。

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
- 正式成片中的 AI 技术图标只允许 `standalone-focus` 或 `open-diagram-symbol` 两种卡片外展示方式；长视频普通镜头默认 0–2 个可见独立图标。
- 开放图解中的流程锚点、决策点、输出和关系线属于语法布局的结构几何，不是 AI 技术图标，也不能退化成标题旁的装饰符号。图标只能通过独立图标计划和共享注册表进入画面。
- 图标联系表、关键片段和既有输出只用于历史评审与回归，不是生产构图模板，也不能用其旧位置恢复卡片图标。
- 图标必须保持辅助层级：文字尺寸、对比度和信息面积高于图标，图标不能替代大标题、解释文字、关系图或证据。
- 是否使用信息卡仍由语义职责和层级决定，不能简化成整屏“全用卡片”或“全不用卡片”；一旦对象选择信息卡，它就保持纯文字。需要解释过程、关系、分支或状态时，优先穿插 `mixed-diagram` / `open-diagram` 图解，而不是继续增加图标。
- 同一 `semanticGroupId + semanticRole + visualHierarchyLevel` cohort 内的对象必须保持相同承载方式；这保证同组一致，但不要求不同语义组或整屏机械地全部套卡片。
- 独立图标必须消费统一的尺寸角色、注册几何和安全槽，不得按场景临时改颜色、比例、线宽、位置算法或嵌入方式。

尺寸只允许使用三种角色：

- `inline = 36px`：只用于旧图标审阅联系表的小号独立展示，正式成片不得嵌入卡片文字；
- `support = 56px`：开放图解中的独立语义对象；
- `focus = 104px`：卡片外的单一概念焦点，每屏最多一个。

可见比例还需同时满足：

- 正式成片不使用行内图标；`support` 独立图标不能侵入标题或信息卡主阅读区；
- `focus` 只用于整屏唯一概念锚点，不能与多张卡片或大段说明文字竞争；
- 图标、文字和容器的缩放只能消费共享尺寸角色和布局测量结果，禁止场景临时放大图标、缩小文字或改变线宽。

## 4. 动效合同

组件接收 Remotion frame 推导出的 `progress`，不使用 CSS animation、transition、计时器或随机数。默认 16 帧进入：整体轻微上移淡入后绘制轮廓，`progress >= 1` 后精确落稳并保持不变。

大标题必须至少领先 12 帧。除品牌水印外，图标不得持续循环；同时运动的图标仍计入全局最多三个运动对象的预算。

推荐调用：

```jsx
<VisualSystemV1StandaloneIcon
  conceptKind="search-retrieval"
  presentation="open-diagram-symbol"
  sizeRole="support"
  progress={progress}
  style={{left, top}}
/>
```

信息卡不调用该组件，也不为图标预留布局空间。明确不需要独立图标时不创建图标计划；未知值直接抛出合同错误。

实际长片 renderer 在调用独立图标组件前还会执行安全槽检查。检查使用完整最终布局的所有节点和所有关系线，而不是只看当前阶段已显示的少量元素；这样后续阶段出现的卡片或箭头也不会与先放入的图标争抢同一位置。

## 5. 对号规则

`verified-success → verified-status-mark → VisualSystemV1StatusMark` 是唯一成功对号路径。它基于 Zhengjiazhi 指定的 [Uiverse / cssbuttons-io / short-shrimp-54](https://uiverse.io/cssbuttons-io/short-shrimp-54) 视觉方向做了 Remotion 帧驱动重实现；运行时不复制网页 CSS 动画，不使用 Unicode、emoji 或场景私有 SVG 对号。

共享状态对号只允许两种语义动效：

- `quiet`：普通清单逐项完成，用约 6 帧克制绘制后稳定保持；
- `celebrate`：只用于一次关键最终验收，用约 18 帧单次 jelly 建立后稳定保持，不能循环。

人工 Gate 图标不再内置小对号；审计清单改用项目圆点。任何真正需要对号的地方都必须组合 `VisualSystemV1StatusMark`，因此同一视频不会再出现圆形对号、手写对号和方形对号三套视觉。对号只能在真实验收项全部完成后出现，禁止无证据成功态。

当前长片 S18 只保留一个 `verified-success`：它以 `open-diagram-symbol` 锚定最终 `adopt` 结果，是位于结果卡外的独立状态图标，并在最终保持阶段才出现。不得把该对号塞回结果卡，也不得复制给中间步骤。

对号没有特殊的遮挡豁免：它必须与普通独立图标一样通过安全槽检查，并避开结果卡的编号、标题、正文、完整边框和相邻箭头。没有合法槽位时宁可不渲染，也不能覆盖文字或破坏关系表达。

## 6. 审批与版本门禁

1. 先生成 28 图标静态联系表：三档尺寸、默认色和状态色；它只验证注册图标，不定义生产摆放方式。
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

可执行真源：`studio/src/video/components/visual-system-v1/ai-watermark.mjs`、`studio/src/video/components/visual-system-v1/brand-layer.jsx`、`studio/public/assets/visual-system-v1/ai-watermark-v013/manifest.json`。
