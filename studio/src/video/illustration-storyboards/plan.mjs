import { VISUAL_SYSTEM_V1 } from "../components/visual-system-v1/tokens.mjs";

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const STORYBOARD_STYLE = freeze({
  id: "mint-object-storyboards-v001", productionApproved: false,
  background: VISUAL_SYSTEM_V1.palette.paper, ink: "#14211D", secondary: "#53685E",
  accent: "#17795D", border: "#5A8A77", pale: "#DDF1E8", white: "#FCFEFD",
  labelSize: 44, detailSize: 32, lineWidth: 3
});

export const STORYBOARDS = freeze([
  { id: "load", compositionId: "IllustrationLoadBoard", layout: "library-to-window",
    title: "按需加载，只取命中的内容", subtitle: "先读目录，匹配之后再展开完整内容。",
    phases: [
      { label: "开始 · 查看目录", caption: "任务是整理报告，先查看各项能力的名称与描述。" },
      { label: "变化 · 展开副本", caption: "只复制命中的报告整理；另外两份资料仍留在原处。" },
      { label: "结果 · 放入上下文", caption: "完整内容进入上下文，三份原件都没有被搬走。" }
    ] },
  { id: "tool", compositionId: "IllustrationToolBoard", layout: "request-response-loop",
    title: "工具调用，要把结果带回来", subtitle: "请求、查找、返回，是三件不同的事。",
    phases: [
      { label: "开始 · 发出查询", caption: "调用方发出查询 A17 的请求，此时还没有结果。" },
      { label: "变化 · 定位记录", caption: "工具按编号找到对应行，返回值必须来自这条记录。" },
      { label: "结果 · 返回调用方", caption: "A17 的状态回到调用方，一次查询才形成闭环。" }
    ] },
  { id: "route", compositionId: "IllustrationRouteBoard", layout: "one-to-many-switch",
    title: "路由选择，让任务走对一路", subtitle: "依据任务匹配能力，不是把所有能力都执行一遍。",
    phases: [
      { label: "开始 · 看见候选", caption: "同一个任务面前有多种能力，先保留完整的选择范围。" },
      { label: "变化 · 选中一路", caption: "根据名称和描述，报告整理与当前任务匹配。" },
      { label: "结果 · 交给选中能力", caption: "任务只交给报告整理；交付任务不等于任务已经完成。" }
    ] }
]);

export function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function orthogonalPath(points) {
  if (!Array.isArray(points) || points.length < 2 ||
    points.some((point) => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) {
    throw new TypeError("A connection needs at least two finite points");
  }
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index], [px, py] = points[index - 1];
    if ((x === px) === (y === py)) throw new Error("Connection segments must be non-zero and orthogonal");
  }
  return points.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ");
}

const sourceDocuments = [
  { id: "image", title: "图片处理", description: "适用：图像任务" },
  { id: "report", title: "报告整理", description: "适用：报告任务" },
  { id: "data", title: "数据核对", description: "适用：数据任务" }
];
const rect = (x, y, width, height) => ({ x, y, width, height });

export function storyboardState(id, phase) {
  const board = STORYBOARDS.find((item) => item.id === id);
  if (!board) throw new RangeError(`Unknown storyboard: ${id}`);
  if (!Number.isInteger(phase) || phase < 0 || phase > 2) throw new RangeError("Static phase must be 0, 1 or 2");
  const common = { id, phase, phaseLabel: board.phases[phase].label, caption: board.phases[phase].caption };
  if (id === "load") {
    const sources = sourceDocuments.map((item, index) => ({ ...item, retained: true,
      selected: phase > 0 && item.id === "report", rect: rect(150, 380 + index * 175, 400, 140) }));
    const context = rect(1175, 365, 605, 510), contextContent = rect(1205, 460, 545, 375);
    const copy = phase === 0 ? null : { sourceId: "report", title: "报告整理",
      rect: phase === 1 ? rect(700, 500, 360, 325) : rect(1235, 490, 485, 330) };
    const connections = phase === 0 ? [] : [{ points: phase === 1 ? [[570, 625], [680, 625]] : [[570, 625], [1155, 625]], active: true }];
    return { ...common, sources, context, contextContent, copy,
      loaded: Boolean(copy && rectContains(contextContent, copy.rect)), connections,
      bounds: [...sources.map((item) => item.rect), context, ...(copy ? [copy.rect] : [])] };
  }
  if (id === "tool") {
    const caller = rect(135, 400, 500, 415), database = rect(1140, 390, 620, 430);
    const records = [{ id: "A16", value: "待处理" }, { id: "A17", value: "已发货" }, { id: "A18", value: "待处理" }];
    const query = "A17", match = phase > 0 ? records.find((item) => item.id === query) : null;
    return { ...common, caller, database, records, query, match, response: phase === 2 ? { ...match } : null,
      connections: [
        { points: [[655, 460], [1120, 460]], active: phase < 2 },
        ...(phase === 2 ? [{ points: [[1120, 765], [655, 765]], active: true }] : [])
      ], bounds: [caller, database, rect(785, 418, 250, 84)] };
  }
  const task = rect(135, 470, 410, 260), router = rect(790, 465, 270, 300);
  const candidates = sourceDocuments.map((item, index) => ({ ...item,
    rect: rect(1390, 320 + index * 225, 345, 125), active: phase > 0 && item.id === "report" }));
  return { ...common, task, router, candidates, selectedId: phase > 0 ? "report" : null,
    dispatchedTo: phase === 2 ? "report" : null, completed: false,
    connections: [
      { points: [[565, 615], [770, 615]], active: phase > 0 },
      { points: [[1080, 520], [1195, 520], [1195, 382], [1370, 382]], active: false },
      { points: [[1080, 615], [1370, 615]], active: phase > 0 },
      { points: [[1080, 710], [1195, 710], [1195, 832], [1370, 832]], active: false }
    ], bounds: [task, router, ...candidates.map((item) => item.rect)] };
}
