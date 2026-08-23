export const AMICRO_UPSTREAM = Object.freeze({
  repository: "https://github.com/Subhan-code/Amicro--Micro-transitions-",
  commit: "07adc1640084940f045875e2bb1b682c90f30c3c",
  license: "MIT",
  copyright: "Copyright (c) 2026 SYED SUBHAN UDDIN"
});

export const MOTION_LIBRARY_CATEGORIES = Object.freeze([
  Object.freeze({ id: "entrance-text", label: "基础入场与正文文字", order: 1 }),
  Object.freeze({ id: "composition-flow", label: "构图、关系与流程", order: 2 }),
  Object.freeze({ id: "state-feedback", label: "界面状态与反馈", order: 3 }),
  Object.freeze({ id: "ai-status", label: "AI 处理状态", order: 4 }),
  Object.freeze({ id: "data-evidence", label: "数据与证据", order: 5 }),
  Object.freeze({ id: "scene-transition", label: "场景转场", order: 6 })
]);

const sharedPolicy = Object.freeze({
  format: "16:9-only",
  fps: 30,
  frameDriven: true,
  deterministic: true,
  palette: "mint-80-purple-20",
  subtitleSafe: false,
  defaultSurface: "flat",
  previewWidth: 960,
  previewHeight: 540,
  // 121 frames plus everyNthFrame=2 yields sampled frames 0…120, so GIF
  // previews contain an explicit final frame that is identical to frame 0.
  previewDurationInFrames: 121
});

function motion(definition) {
  return Object.freeze({
    ...sharedPolicy,
    motionIntensity: "low",
    depthPolicy: "flat-only",
    textPolicy: "content-only",
    previewLoop: "enter-hold-exit",
    ...definition,
    previewPath: `docs/assets/motion-library/${definition.category}/${definition.id}.gif`,
    upstream: Object.freeze(definition.upstream.map((item) => Object.freeze(item)))
  });
}

export const MOTION_LIBRARY_ITEMS = Object.freeze([
  motion({
    id: "fade-in",
    title: "Fade In",
    titleZh: "平稳淡入",
    category: "entrance-text",
    summary: "内容保持原位，以低干扰透明度变化进入。",
    useWhen: ["场景内补充说明", "证据元素出现", "低优先级内容进入"],
    avoidWhen: ["字幕", "需要表达方向关系时"],
    upstream: [{ path: "registry/ui/entrance/fade-in.tsx", symbol: "FadeIn" }]
  }),
  motion({
    id: "fade-up",
    title: "Fade Up",
    titleZh: "轻微上移淡入",
    category: "entrance-text",
    summary: "从下方少量位移进入，适合标题或关键结论。",
    useWhen: ["页面标题", "关键结论", "小型模块"],
    avoidWhen: ["字幕", "连续密集列表"],
    upstream: [{ path: "registry/ui/entrance/fade-up.tsx", symbol: "FadeUp" }]
  }),
  motion({
    id: "fade-down",
    title: "Fade Down",
    titleZh: "轻微下移淡入",
    category: "entrance-text",
    summary: "从上方少量位移进入，适合标签与次级提示。",
    useWhen: ["章节标签", "状态说明", "上方注释"],
    avoidWhen: ["字幕", "大面积内容"],
    upstream: [{ path: "registry/ui/entrance/fade-down.tsx", symbol: "FadeDown" }]
  }),
  motion({
    id: "slide-left",
    title: "Slide Left",
    titleZh: "左向接管",
    category: "entrance-text",
    summary: "内容从右侧进入并向左完成接管，表达前进关系。",
    useWhen: ["流程推进", "前后步骤切换", "局部页面接管"],
    avoidWhen: ["字幕", "无方向语义的装饰"],
    upstream: [{ path: "registry/ui/entrance/slide-left.tsx", symbol: "SlideLeft" }]
  }),
  motion({
    id: "slide-right",
    title: "Slide Right",
    titleZh: "右向返回",
    category: "entrance-text",
    summary: "内容从左侧进入，适合表达返回、回溯或结果回流。",
    useWhen: ["结果回流", "回到上一层", "反向关系"],
    avoidWhen: ["字幕", "无方向语义的装饰"],
    upstream: [{ path: "registry/ui/entrance/slide-right.tsx", symbol: "SlideRight" }]
  }),
  motion({
    id: "scale-in",
    title: "Scale In",
    titleZh: "克制缩放进入",
    category: "entrance-text",
    summary: "从 97% 左右恢复到完整尺寸，不使用明显弹跳。",
    useWhen: ["重点对象聚焦", "小型独立模块", "确认结果"],
    avoidWhen: ["同级卡片差异化", "字幕"],
    upstream: [{ path: "registry/ui/entrance/scale-in.tsx", symbol: "ScaleIn" }]
  }),
  motion({
    id: "text-reveal",
    title: "Text Reveal",
    titleZh: "文字遮罩揭示",
    category: "entrance-text",
    summary: "通过平稳遮罩展开正文或标题，不闪烁、不逐字跳动。",
    useWhen: ["标题", "正文关键句", "章节判断"],
    avoidWhen: ["字幕", "长段落"],
    upstream: [{ path: "registry/ui/text/text-reveal.tsx", symbol: "TextReveal" }]
  }),
  motion({
    id: "word-reveal",
    title: "Word Reveal",
    titleZh: "中文分词依次揭示",
    category: "entrance-text",
    summary: "按中文词组依次进入，用于短句层级而非逐字炫技。",
    useWhen: ["短标题", "三到五个关键词", "因果短句"],
    avoidWhen: ["字幕", "长段落", "需要同时阅读的证据原文"],
    upstream: [{ path: "registry/ui/text/word-reveal.tsx", symbol: "WordReveal" }]
  }),

  motion({
    id: "card-linear-spread",
    title: "Card Linear Spread",
    titleZh: "同级卡片线性展开",
    category: "composition-flow",
    summary: "同级平面模块从重叠状态等距铺开，保持相同尺寸与表面。",
    useWhen: ["并列概念", "同级选项", "阶段总览"],
    avoidWhen: ["单一大内容", "把完整页面包进大卡片"],
    upstream: [{ path: "src/components/cards/CardLinearSpread.tsx", symbol: "CardLinearSpread" }]
  }),
  motion({
    id: "card-cascade-stagger",
    title: "Card Cascade Stagger",
    titleZh: "卡片级联入场",
    category: "composition-flow",
    summary: "同级模块按阅读顺序依次进入，最终严格对齐。",
    useWhen: ["步骤列表", "三到五项支持点", "分层说明"],
    avoidWhen: ["字幕", "需要同时比较的关键数据"],
    upstream: [{ path: "src/components/cards/CardCascadeStagger.tsx", symbol: "CardCascadeStagger" }]
  }),
  motion({
    id: "card-arc",
    title: "Card Arc",
    titleZh: "卡片弧形编排",
    category: "composition-flow",
    summary: "少量卡片形成克制弧线，仅用于概念集合的短暂总览。",
    useWhen: ["概念集合", "备选路径", "素材组"],
    avoidWhen: ["严谨流程", "需要逐字阅读的卡片", "默认同级卡片布局"],
    motionIntensity: "medium",
    depthPolicy: "flat-surface-spatial-layout",
    upstream: [{ path: "src/components/cards/CardArc5.tsx", symbol: "CardArc5" }]
  }),
  motion({
    id: "circuit-trace-draw",
    title: "Circuit Trace Draw",
    titleZh: "调用线路绘制",
    category: "composition-flow",
    summary: "线段从源节点向目标节点生长，用于解释调用路径。",
    useWhen: ["Agent 调用", "数据流", "受控执行路径"],
    avoidWhen: ["无真实关系的装饰线", "密集时序图"],
    upstream: [{ path: "src/components/css-animations/whimsical/RedesignedPhysicsTrios.tsx", symbol: "CircuitTraceDraw" }]
  }),
  motion({
    id: "hexagon-lattice-draw",
    title: "Hexagon Lattice Draw",
    titleZh: "能力网络展开",
    category: "composition-flow",
    summary: "轻量六边形网络按中心向外展开，表达模块化能力关系。",
    useWhen: ["能力地图", "模块组合", "协议网络"],
    avoidWhen: ["真实流程顺序", "超过十二个节点"],
    upstream: [{ path: "src/components/css-animations/whimsical/RedesignedPhysicsTrios.tsx", symbol: "HexagonLatticeDraw" }]
  }),
  motion({
    id: "modular-tile-snap",
    title: "Modular Tile Snap",
    titleZh: "模块吸附成组",
    category: "composition-flow",
    summary: "独立模块吸附成规则网格，表达能力被组织为系统。",
    useWhen: ["能力归类", "组件组合", "从散点到结构"],
    avoidWhen: ["单一大内容", "模块并非同级时"],
    upstream: [{ path: "src/components/css-animations/whimsical/RedesignedPhysicsTrios.tsx", symbol: "ModularTileSnap" }]
  }),
  motion({
    id: "segmented-link-stretch",
    title: "Segmented Link Stretch",
    titleZh: "分段连接伸展",
    category: "composition-flow",
    summary: "短连接段依次伸展并对接，表达标准接口建立。",
    useWhen: ["协议连接", "工具接入", "链路组装"],
    avoidWhen: ["复杂多分支网络", "无接口语义时"],
    upstream: [{ path: "src/components/css-animations/whimsical/ConceptTrios3.tsx", symbol: "SegmentedLinkStretch" }]
  }),
  motion({
    id: "domino-chain",
    title: "Domino Chain",
    titleZh: "因果链推进",
    category: "composition-flow",
    summary: "节点按顺序产生轻微倾转与传递，用于短因果链。",
    useWhen: ["因果关系", "连续触发", "依赖传播"],
    avoidWhen: ["关键数据展示", "长流程", "厚重 3D"],
    motionIntensity: "medium",
    upstream: [{ path: "src/components/css-animations/whimsical/WhimsicalVariations.tsx", symbol: "DominoChain" }]
  }),

  motion({
    id: "filter-tag-pill",
    title: "Filter Tag Pill",
    titleZh: "筛选标签确认",
    category: "state-feedback",
    summary: "标签从待选状态进入已选择状态，适合表达条件生效。",
    useWhen: ["条件筛选", "约束启用", "标签选择"],
    avoidWhen: ["字幕", "大标题"],
    upstream: [{ path: "src/components/css-animations/yui-components/UiKitTrios.tsx", symbol: "FilterTagPill" }]
  }),
  motion({
    id: "morph-action-pill",
    title: "Morph Action Pill",
    titleZh: "动作胶囊展开",
    category: "state-feedback",
    summary: "小图标扩展为带文字的动作提示，用于一次性确认。",
    useWhen: ["动作确认", "结果提示", "小型独立模块"],
    avoidWhen: ["连续浮动", "大面积容器"],
    upstream: [{ path: "src/components/css-animations/yui-components/UiKitTrios.tsx", symbol: "MorphActionPill" }]
  }),
  motion({
    id: "segmented-step-bar",
    title: "Segmented Step Bar",
    titleZh: "分段步骤条",
    category: "state-feedback",
    summary: "按步骤点亮同色分段，表达当前执行位置。",
    useWhen: ["短流程进度", "阶段状态", "执行链"],
    avoidWhen: ["替代全片章节进度", "显示秒数"],
    upstream: [{ path: "src/components/css-animations/yui-components/UiKitTrios.tsx", symbol: "SegmentedStepBar" }]
  }),
  motion({
    id: "segmented-stepper-dots",
    title: "Segmented Stepper Dots",
    titleZh: "步骤节点推进",
    category: "state-feedback",
    summary: "节点与连接线同步推进，适合小型执行状态模块。",
    useWhen: ["Agent 阶段", "审核步骤", "状态切换"],
    avoidWhen: ["全片底部章节进度", "大面积流程图"],
    upstream: [{ path: "src/components/css-animations/yui-components/RedesignedUiTrios.tsx", symbol: "SegmentedStepperDots" }]
  }),
  motion({
    id: "card-glance-preview",
    title: "Card Glance Preview",
    titleZh: "小模块预览展开",
    category: "state-feedback",
    summary: "小型条目在原位展开补充信息，不创建大卡片套页面。",
    useWhen: ["证据摘要", "术语解释", "局部详情"],
    avoidWhen: ["完整页面", "大内容窗口", "同级卡片表面混用"],
    upstream: [{ path: "src/components/css-animations/yui-components/RedesignedUiTrios.tsx", symbol: "CardGlancePreview" }]
  }),
  motion({
    id: "bookmark-save-pill",
    title: "Bookmark Save Pill",
    titleZh: "保存状态确认",
    category: "state-feedback",
    summary: "书签图标平稳转为已保存状态，表达结果持久化。",
    useWhen: ["结果保存", "版本固化", "资产入库"],
    avoidWhen: ["无保存语义的装饰"],
    upstream: [{ path: "src/components/css-animations/yui-components/RedesignedUiTrios.tsx", symbol: "BookmarkSavePill" }]
  }),
  motion({
    id: "checkbox-draw",
    title: "Checkbox Draw",
    titleZh: "检查项完成",
    category: "state-feedback",
    summary: "边框稳定出现后绘制勾选路径，用于验收完成。",
    useWhen: ["检查项", "验证通过", "完成标准"],
    avoidWhen: ["尚未确认的结果", "连续装饰"],
    upstream: [
      { path: "src/components/forms/AnimatedFormElement.tsx", symbol: "AnimatedCheckbox" },
      { path: "src/data/formElements.ts", symbol: "formElementsData" }
    ]
  }),
  motion({
    id: "form-submit-morph",
    title: "Form Submit Morph",
    titleZh: "提交结果变形",
    category: "state-feedback",
    summary: "提交动作从进行中平稳变为完成状态。",
    useWhen: ["人工批准", "提交完成", "结果返回"],
    avoidWhen: ["自动通过的误导", "没有真实结果时"],
    upstream: [
      { path: "src/components/forms/AnimatedFormElement.tsx", symbol: "AnimatedSubmit" },
      { path: "src/data/formElements.ts", symbol: "formElementsData" }
    ]
  }),

  motion({
    id: "smooth-dot-shift",
    title: "Smooth Dot Shift",
    titleZh: "处理点位流转",
    category: "ai-status",
    summary: "三个点位平滑换位，表示任务正在不同处理单元间流转。",
    useWhen: ["短暂处理中", "节点调度", "等待返回"],
    avoidWhen: ["长时间持续播放", "字幕附近"],
    previewLoop: "continuous-seamless",
    upstream: [{ path: "registry/ui/loading/smooth-dot-shift.tsx", symbol: "SmoothDotShift" }]
  }),
  motion({
    id: "magnetic-dots",
    title: "Magnetic Dots",
    titleZh: "能力聚合",
    category: "ai-status",
    summary: "点位先分散后聚合，表达上下文或能力汇入当前任务。",
    useWhen: ["上下文聚合", "多源输入", "能力汇入"],
    avoidWhen: ["真实物理关系", "长时间循环"],
    previewLoop: "continuous-seamless",
    upstream: [{ path: "registry/ui/loading/magnetic-dots.tsx", symbol: "MagneticDots" }]
  }),
  motion({
    id: "arc-tracer",
    title: "Arc Tracer",
    titleZh: "环形处理进度",
    category: "ai-status",
    summary: "单一弧线沿圆周推进，适合小型处理状态。",
    useWhen: ["处理中", "单任务等待", "后台执行"],
    avoidWhen: ["播放器进度", "章节进度", "显示具体百分比时"],
    previewLoop: "continuous-seamless",
    upstream: [{ path: "registry/ui/loading/arc-tracer.tsx", symbol: "ArcTracer" }]
  }),
  motion({
    id: "morphing-bars",
    title: "Morphing Bars",
    titleZh: "处理强度柱",
    category: "ai-status",
    summary: "同色柱体平稳改变高度，表达计算活跃而非真实数据。",
    useWhen: ["模型处理中", "语音或流式响应", "活跃状态"],
    avoidWhen: ["需要精确数据", "字幕闪烁式装饰"],
    previewLoop: "continuous-seamless",
    upstream: [{ path: "registry/ui/loading/morphing-bars.tsx", symbol: "MorphingBars" }]
  }),
  motion({
    id: "waveform-loader",
    title: "Waveform Loader",
    titleZh: "波形处理状态",
    category: "ai-status",
    summary: "低幅波形表示音频、流或模型处理活动。",
    useWhen: ["语音处理", "流式响应", "实时分析"],
    avoidWhen: ["没有音频或流语义时", "字幕背景"],
    previewLoop: "continuous-seamless",
    upstream: [{ path: "registry/ui/loading/waveform-loader.tsx", symbol: "WaveformLoader" }]
  }),
  motion({
    id: "shape-shift-grid",
    title: "Shape Shift Grid",
    titleZh: "网格状态变换",
    category: "ai-status",
    summary: "规则网格的局部形态平稳变化，表达内部状态重组。",
    useWhen: ["模型内部处理", "模块重排", "状态重组"],
    avoidWhen: ["需要解释具体节点关系时", "高频闪烁"],
    previewLoop: "continuous-seamless",
    upstream: [{ path: "registry/ui/loading/shape-shift-grid.tsx", symbol: "ShapeShiftGrid" }]
  }),

  motion({
    id: "mono-rounded-line",
    title: "Mono Rounded Line",
    titleZh: "证据折线生长",
    category: "data-evidence",
    summary: "折线按时间方向绘制，只保留图表主体与必要标注。",
    useWhen: ["趋势证据", "前后变化", "时间序列"],
    avoidWhen: ["无数据来源", "把图表包进第二层大卡片"],
    upstream: [{ path: "src/components/mono-charts/MonoRoundedLineChart.tsx", symbol: "MonoRoundedLineChart" }]
  }),
  motion({
    id: "mono-rounded-bar",
    title: "Mono Rounded Bar",
    titleZh: "证据柱状比较",
    category: "data-evidence",
    summary: "圆角柱体从基线增长，用于少量分类对比。",
    useWhen: ["分类比较", "前后差异", "结果证据"],
    avoidWhen: ["超过七个分类", "无数据来源", "仪表盘拼贴"],
    upstream: [{ path: "src/components/mono-charts/MonoRoundedBarChart.tsx", symbol: "MonoRoundedBarChart" }]
  }),
  motion({
    id: "mono-rounded-sankey",
    title: "Mono Rounded Sankey",
    titleZh: "流向证据图",
    category: "data-evidence",
    summary: "三层以内的流向带按源到目标展开，用于解释分配关系。",
    useWhen: ["流量分配", "能力路由", "成本或任务去向"],
    avoidWhen: ["密集多节点", "无精确流向数据", "默认架构图"],
    upstream: [{ path: "src/components/mono-charts/MonoRoundedSankeyChart.tsx", symbol: "MonoRoundedSankeyChart" }]
  }),

  motion({
    id: "split-gate-reveal",
    title: "Split Gate Reveal",
    titleZh: "分屏揭示",
    category: "scene-transition",
    summary: "两侧平面短暂分开揭示新内容，只在语义环境切换时使用。",
    useWhen: ["章节级语义切换", "前后对照揭示"],
    avoidWhen: ["句子级切换", "连续十五秒内重复使用"],
    motionIntensity: "medium",
    upstream: [{ path: "src/components/css-animations/whimsical/RedesignedPhysicsTrios.tsx", symbol: "SplitGateReveal" }]
  }),
  motion({
    id: "radial-iris-mask",
    title: "Radial Iris Mask",
    titleZh: "径向聚焦揭示",
    category: "scene-transition",
    summary: "从焦点位置扩张的圆形遮罩揭示新内容，低频使用。",
    useWhen: ["聚焦一个关键对象", "章节级揭示"],
    avoidWhen: ["字幕切换", "连续页面切换", "无明确焦点时"],
    motionIntensity: "medium",
    upstream: [
      { path: "src/components/PageTransitionOverlay.tsx", symbol: "PageTransitionOverlay" },
      { path: "src/data/transitions.ts", symbol: "RadialIrisPortal" }
    ]
  })
]);

const itemById = new Map(MOTION_LIBRARY_ITEMS.map((item) => [item.id, item]));

export function getMotionLibraryItem(id) {
  const item = itemById.get(id);
  if (!item) throw new TypeError(`未知动效：${id}`);
  return item;
}

export function motionLibraryItemsByCategory(category) {
  return MOTION_LIBRARY_ITEMS.filter((item) => item.category === category);
}
