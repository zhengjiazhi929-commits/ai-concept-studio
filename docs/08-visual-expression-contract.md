# 视频视觉表达合同 v1

这份合同解决的不是“某个文件夹、纸张或箭头怎么画”，而是每个场景在绘制前必须回答：为什么要画、要解释什么、删掉图形会损失什么理解，以及最终画面怎样保持统一风格、色彩、比例和时序。

可执行真源：

- 语义合同与校验器：`studio/src/shared/visual-expression-contract.mjs`
- 长视频编辑规则与序列节奏校验：`studio/src/shared/editorial-visual-policy.mjs`
- 按真实文案测算卡片宽度与分行重排：`studio/src/video/components/visual-system-v1/content-layout.mjs`
- 通用视觉语法布局：`studio/src/video/components/visual-system-v1/grammar-layout.mjs`
- visual-system-v1 候选适配器：`studio/src/video/components/visual-system-v1/resolver.mjs`
- Remotion 语义绑定组件：`studio/src/video/components/visual-system-v1/semantic-components.jsx`
- 通用失败矩阵：`studio/tests/visual-expression-contract.test.mjs`

## 1. 三层职责

### Storyboard 语义层

只描述：

- 观众问题与最终结论；
- 内容是判断、解释还是证据；
- 图形贡献是展示顺序、差异、层级、分支、数量、证据或状态变化；
- 有哪些语义对象、对象之间是什么关系；
- 每个对象和关系绑定哪条旁白主张；
- 哪些内容明确不能出现。

不得描述：

- `x/y/width/height`；
- SVG path、图标名、文件夹、纸张等具体物体；
- 十六进制颜色、场景私有字号、阴影或渐变；
- 具体组件实现和绘制顺序。

### 视觉系统解析层

根据语义意图稳定选择 `none`、`single-focus`、`comparison`、`flow`、`branch`、`hierarchy`、`timeline`、`quantity`、`evidence` 等结构，再把抽象颜色、字号和线条角色交给当前已批准视觉参数真源解析。

这里决定统一风格，不允许场景自行换色、缩字或创建新的视觉语言。语法只定义“对比、顺序、层级、分支怎样形成可读关系”，不定义“必须画文件夹、纸张、人物或某个图标”。

### 最终帧 QA 层

对真实代表帧和边界帧检查：

- 安全区、裁切和重叠；
- 文图面积比例和最小字号；
- 同级对象尺寸；
- 强调色、高亮和运动对象预算；
- 箭头方向、端点、穿线和交叉；
- 是否出现被禁止的人物、机器人或氛围性插画；
- 每个渲染元素能否通过 `data-semantic-id` 回指合同。

语义合同通过不能替代实际 MP4/代表帧视觉检查。

布局采样分两类，结论不能混用：

- `deterministic-layout-sample`：由同一语法布局器计算，自动阻断越界、重叠、缺元素、缺关系、字号、比例和连线问题；
- `rendered-frame-review`：从真实 MP4 提取代表帧、边界帧和联系表，由人工检查视觉层级、物理合理性、文字遮挡与整体观感。

前者是代码 Gate，后者才是成片视觉验收。自动采样通过不得写成“已人工看完视频”。

生产链路只在 MP4 渲染成功并取得成片 SHA-256 后持久化前者，位置为
`render.deterministicLayoutSampleSet`。集合和每个样本都必须登记：

- `sampleType: "deterministic-layout-sample"` 与当前 sample schema 版本；
- renderer contract 版本、Storyboard style profile 与 Remotion composition ID；
- 当前 render version 和成片 SHA-256，防止旧样本复用到新成片；
- `assurance: "deterministic-layout-only"`、`pixelInspection: false`、`humanVisualQa: false`。

QA 会把当前 render 记录中的样本映射回对应场景执行合同检查，并拒绝缺场景、
版本不符、renderer/style 不符或未绑定当前成片的样本。它不会读取 Storyboard 中手工
塞入的同名字段来冒充渲染证据，也不会替代真实 MP4 抽帧、联系表检查和 1× 完整观看。

## 2. 什么时候画，什么时候只用文字

| 信息需求 | 默认结构 | 图形必须增强的理解 |
|---|---|---|
| 单一判断、定义、章节结论 | `none` / 纯文字 | 不强制画图；避免为了填空白加装饰插画 |
| 抽象概念锚点 | `single-focus` | 帮助观众绑定概念，但不能代替主标题 |
| 对象关系、因果、依赖 | `node-link` / `flow` | 说明谁影响谁、谁依赖谁 |
| 操作先后 | `flow` | 显示起点、终点、顺序和方向 |
| 同维度差异 | `comparison` | 让共同维度、基准和差异可直接比较 |
| 组成、归属、层级 | `hierarchy` | 显示父子关系和同级权重 |
| 条件与结果 | `branch` | 显示根节点、条件和至少两个结果 |
| 真实时间演变 | `timeline` | 显示时间锚点和统一方向 |
| 数量、趋势、分布 | `quantity` | 显示指标、单位、分母、范围和来源 |
| 真实证据 | `evidence` | 把主张绑定到真实来源与必要上下文 |
| 状态前后变化 | `state-change` | 显示变化前、变化后和触发条件 |

图形只有在 `contributionRationale` 能明确说明“删掉图形后会损失什么理解”时才允许生成。纯装饰、重复文字和无来源成功态必须失败。

长视频还要通过序列层的表达节奏检查：

- 任意连续 3 个镜头中，至少 1 个必须是 `mixed-diagram` 或 `open-diagram`，避免观众长时间只看“卡片 + 关键词”；
- `ai-tech-longform` 中 `card-led` 场景占比不得超过 50%，且不得连续出现 2 个 `card-led` 镜头；这两个阈值由编辑策略执行，不用临时主观判断代替；
- `mixed-diagram` 要让纯文字信息卡与关系、顺序、决策或状态图解各自承担不同信息，不是在卡片标题或正文旁贴图标；
- `mixed-diagram` 中至少一个开放图解对象必须声明 `carriesRelation: true`；独立图标只帮助识别概念或状态，不能冒充关系图解；
- `open-diagram` 使用开放画布上的节点、条带、锚点、决策点和输出等图解对象，不伪装成信息卡；阶段切换只显示当前讲解需要的对象和关系，不能一次把全图堆到画面上。

### 可执行解析顺序

每个新场景都按同一顺序处理，不能从“先找一个好看的图标”开始：

1. 把旁白拆成可追溯的 `claims`，标记哪条主张确实需要视觉表达；
2. 写清观众问题 `question` 和看完后的唯一结论 `takeaway`；
3. 选择 `informationNeed`，说明需要理解的是关系、顺序、差异、层级、分支、数量、证据还是状态变化；
4. 用 `entities` 和 `relations` 表达内容语义，每个对象和关系都绑定 `claimIds`；
5. resolver 确定结构、阅读方向和构图 profile，Storyboard 不提供坐标、图标或颜色；
6. 通用语法布局器按结构生成焦点、步骤、两侧对照、层级根节点、分支决策点、时间锚点等不同原语；
7. 最终保持帧必须包含全部计划对象与关系，再通过尺寸、留白、颜色、字号、裁切、重叠和连线 Gate。

任何一步失败都应退回前一步修正语义或拆镜头，不允许靠缩小文字、增加装饰、堆卡片或绕过检查来“塞下”。

## 3. 统一风格与比例

生产合同当前绑定已批准 profile `desktop-light-window-editorial-v3`，其参数真源是 `studio/config/visual-system.json`。`visual-system-v1` 仍是特定长片候选的实现适配器，未替代全局批准真源：

- 扁平二维几何语言，默认无透视、伪 3D、厚重阴影和装饰渐变；
- 场景只引用颜色角色，不写原始颜色值；
- 每屏最多两个非中性强调角色；
- 成功、警告、错误色必须绑定可验证状态；
- 同级对象使用同一尺寸和 typography role；
- 正文字号不低于 28px，阶段标题不低于 46px；
- 单屏最多 12 个可见语义对象、3 个同时高亮、3 个同时运动对象；
- 文字优先场景文字面积至少 60%，图形面积至多 40%；
- 关系优先和证据优先场景必须显式选择对应 composition profile；
- 标题、图形、字幕区域至少保留 24px 间距；放不下时拆镜头，不静默缩字。

文字是信息卡的主体，长标题必须按内容驱动布局：

- 信息卡标题默认只允许一行，使用 `white-space: nowrap`、`word-break: keep-all`、`overflow-wrap: normal`，禁止中文词内或英文词内硬断行；
- 测量到标题放不下时，先加宽该卡片，当前行空间不足则全局重排为最多 2 行；不得为保持固定卡片数量而缩字或断词；
- 在最大安全宽度和 2 行内仍不能容纳时必须 fail closed，返回修改文案或拆镜头，不让溢出、遮挡或裁切进入渲染。

卡片和图解必须先区分角色，不能混为“卡片 + 关键词”模板：

- 判断不是“这个场景要么全用卡片、要么全不用卡片”。每个对象先声明 `semanticRole`、`visualHierarchyLevel`、`surfaceRole` 和 `surfacePurpose`，再由语义与层级决定承载方式；不得为了变化感随机混用；
- 每个受治理的视觉对象还必须声明 `semanticGroupId`。同一场景中 `semanticGroupId + semanticRole + visualHierarchyLevel` 相同的对象必须使用同一种 `surfaceRole`；跨语义组、不同角色或不同层级只有在信息职责确实不同时才可以混合；
- 这条同组一致性规则不是“整屏全用卡片或全不用卡片”。一个场景可以同时有信息卡和开放图解，但必须由语义分组、角色与层级解释这种差异，不能随机混搭；
- 信息卡的 `surfacePurpose` 只允许 `focus-result`、`decision-boundary`、`actionable-object`、`state-container`；开放图解只允许 `process-anchor`、`relationship-structure`、`transition-output`。`decoration` 不是合法理由；
- `surfacePlanById` 是 validator、语法布局器和 Remotion renderer 的共同真源。`primitive` 只决定流程锚点、层级节点、决策点等几何语法，不能再独自决定是否画完整卡片；
- 只有承载一组完整信息的容器才标记为 `surfaceRole: "information-card"`；时间锚点、数量条、决策点、关系线和移动中的物体仍保持图解对象，不强制套卡片；
- 信息卡必须使用四边完整、清晰可见的 `full-outline`，边框 2–3px、统一线条角色、圆角 14–24px且无阴影；单侧边线不能冒充卡片边框；
- 信息卡内容模式固定为 `text-only`：标题、正文和必要眉题可以进入卡片，AI 技术图标不得进入卡片标题行、正文行或占据卡片预留槽位；每张信息卡的图标预算为 0；
- 开放图解对象标记为 `open-canvas` / `diagram-object`，可以不使用封闭外框；这是为了保持关系图、过程图和状态图的可读性，不得反过来用于省略信息卡的边框；
- 聚焦态可以把同一完整外框切换为强调色，但不能隐藏其余三边，也不能靠光晕或厚重阴影制造层级；
- 图案必须编码对象、动作、空间位置或因果关系。删掉图案后若不损失顺序、分支、状态或物理关系理解，就应改为纯文字，而不是添加装饰图标。

图案和图标的统一规则：

- 不画人物、氛围性机器人、装饰性假图或不符合物理规律的物体动作；只画能直接解释对象、关系、顺序、分支、状态和交互的必要几何；
- 同一片子复用同一扁平二维语法、颜色 token、线宽、圆角、光学安全边距和三档尺寸角色；不允许场景私有插画风格；
- 开放图解只消费 `grammar-layout.mjs` 注册的通用语义原语，由解析器为当前内容选择组合；这些流程锚点、决策点、输出和关系线是图解结构，不是卡内图标。镜头不得自创 SVG、私有配色或一次性插画组件；
- 文字保持第一层级，AI 技术图标只允许作为卡片外的独立视觉对象，以 `standalone-focus` 或 `open-diagram-symbol` 呈现；长视频每镜头默认 0–2 个独立图标，且每个必须登记 `purpose` 和所锚定的语义对象；
- 独立图标必须通过安全槽计算后才能出现：候选位置需完整落在安全区内，并避开全部节点、文字容器和连线；找不到合法槽位时返回 `render: false`，不得靠缩小、裁切、覆盖或强行挤入来显示；
- 当前长片 S18 的完成对号是锚定最终 `adopt` 结果、位于卡片外的独立状态图标；它不得嵌回结果卡，也不能复制到每个中间节点。对号同样服从安全槽规则，不能遮住编号、文字、边框或箭头。

通用阈值由 `VISUAL_EXPRESSION_STYLE_POLICY` 管理；生产颜色必须绑定已批准 profile 的语义 token。候选 renderer 可以使用自己的适配器，但必须显式标记 candidate profile，不能静默冒充生产 profile。

## 4. 箭头、人物与动效

箭头不是装饰：

- 箭头数量由当前可见的有向关系决定，不使用固定的“最多几个箭头”替代语义；
- 比较、层级和无向关联默认使用无箭头关系线；
- 每条关系必须声明语义类型与语义标签；箭头必须绑定关系 ID、起点、终点和旁白 claim，只有显式有向关系才绘制箭头；
- 连线不得穿过无关节点、文字或另一条无共享端点的关系线；
- 本合同下的生产连线只允许水平段、垂直段和 90° 转弯；禁止斜线与 `smooth-curve`。当前长片在布局和连线路由调用中强制使用 `connectorPolicy: "orthogonal-only"`，确定性布局样本也会拒绝任何非正交线段；
- 布局默认使用 `stable-final`：先按完整关系图确定最终几何，各阶段只控制显隐，不重排已经出现的节点。只有明确声明 `explicit-reflow` 并提供 `reflowJustification` 时才允许阶段重排；
- 每个阶段可以显式声明 `visibleNodeIds` 与 `visibleEdgeIds`，把同时可见对象限制在当前讲解所需范围；新增关系必须等两端对象进入当前可见集合后才能显示，端点未出现时不能先画线；
- 阶段密度仍受全局可见对象、高亮与运动预算约束。本 10 分钟长片采用更严格的每阶段与相邻阶段过渡预算：最多 6 个可见语义对象和 6 条关系线；卡片动效必须服务于顺序、关系或状态讲解，不能为了动效把互不相关的卡片同时堆出。

本长视频视觉语法禁止人物和机器人插画。审批、验收、目标设定和用户决策使用决策点、门禁或状态对象表达，不用人物代替语义。

动效只表达进入、顺序、关系、状态和强调，并由 Remotion frame 驱动。大标题先出现，小字和字幕至少后置 12 帧，主图和细节继续分层进入；禁止 CSS animation/transition。

## 5. 生成与审批链路

新生成的 Storyboard 必须输出：

```js
{
  visualContractVersion: "visual-expression-contract-v1",
  scenes: [{
    visualIntent: { /* 观众问题、主张、实体与关系 */ },
    visualPlan: { /* resolver 稳定生成的结构与 token policy */ }
  }]
}
```

`visualIntent` 和 `visualPlan` 都进入 Storyboard Gate 哈希。修改视觉含义、结构或风格绑定会使旧批准失效，不能在批准后静默更改。

`deterministicLayoutSampleSet` 是 Render Agent 的后渲染证据，不进入 Storyboard Gate
哈希；这样补写样本不会静默改变已经批准的分镜。每次重渲染都会绑定新的 render
version 和成片 SHA-256，QA 只接受当前版本。

历史分镜没有该字段时保持只读兼容；从当前版本开始的新生成分镜必须通过 `visual-expression-contract` 质量检查。

## 6. 样例与全局规则的边界

`agent-skill-illustration-style-proof` 中的文件夹、纸张、对比符号和流程图只是某次候选的渲染实现。它们可以消费通用合同，但不能反向成为合同：

- “要展示来源收束成能力单元”是全局语义；
- “用三张纸塞进文件夹”只是一个可替换实现；
- “要展示步骤的先后关系”是全局语义；
- “具体画几个框、走哪条 SVG path”属于渲染器。

以后换主题、换内容或换构图时，语义合同和 QA 标准保持不变，具体图案可以完全不同。

图标联系表、关键片段和既有成片只记录当时的历史评审证据，用来复核注册几何、状态和动效；它们不是生产构图模板。新场景不得因为旧输出曾把图标放进卡片，就复用该位置或恢复卡片图标槽。
