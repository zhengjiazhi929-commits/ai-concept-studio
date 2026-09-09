import { illustrationExample } from "./catalog.mjs";
import { ILLUSTRATION_GEOMETRY, horizontalCenter } from "./geometry.mjs";

export function progressBetween(frame, start, end) {
  if (![frame, start, end].every(Number.isFinite) || end <= start) throw new Error("Invalid action interval");
  const t = Math.max(0, Math.min(1, (frame - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function pointOnOrthogonalRoute(points, progress) {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(progress)) throw new Error("Invalid route");
  const lengths = points.slice(1).map(([x, y], i) => {
    const [px, py] = points[i];
    if (![x, y, px, py].every(Number.isFinite) || (px !== x && py !== y)) throw new Error("Route must be orthogonal");
    return Math.abs(x - px) + Math.abs(y - py);
  });
  let remaining = lengths.reduce((sum, value) => sum + value, 0) * Math.max(0, Math.min(1, progress));
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const fraction = lengths[i] === 0 ? 0 : remaining / lengths[i];
      return { x: points[i][0] + (points[i + 1][0] - points[i][0]) * fraction,
        y: points[i][1] + (points[i + 1][1] - points[i][1]) * fraction };
    }
    remaining -= lengths[i];
  }
  throw new Error("Invalid route length");
}

export function illustrationFrameState(input, frame, geometry = ILLUSTRATION_GEOMETRY) {
  const example = typeof input === "string" ? illustrationExample(input) : input;
  const { id, copy } = example;
  if (!Number.isInteger(frame) || frame < 0 || frame >= example.definition.durationInFrames) throw new Error("Frame out of range");
  const action = (actionId) => example.definition.actions.find((entry) => entry.id === actionId);
  const progress = (actionId) => progressBetween(frame, action(actionId).fromFrame, action(actionId).toFrame);
  if (id === "select-load") {
    const g = geometry.selection;
    const loaded = frame >= action("load").toFrame;
    const selected = frame >= action("match").fromFrame;
    const packetVisible = frame >= action("load").fromFrame;
    return { selected: frame >= action("match").fromFrame, selectedAmount: progress("match"),
      packetVisible, packet: pointOnOrthogonalRoute([[g.sourceX + 25, g.sourceY + copy.selectedIndex * g.rowGap],
        [g.destination.x, g.sourceY + copy.selectedIndex * g.rowGap], [g.destination.x, g.destination.y]], progress("load")),
      sourceRetained: true, loaded, phase: !selected ? 0 : !packetVisible ? 1 : loaded ? 3 : 2,
      cue: !selected ? "目录只展示可选材料" : !packetVisible ? `匹配当前任务：只选中“${copy.documents[copy.selectedIndex]}”` : loaded ? "命中的内容已载入；原材料仍保留" : "复制命中的内容，载入上下文" };
  }
  if (id === "request-return") {
    const g = geometry.request;
    const queried = frame >= action("lookup").toFrame;
    const returned = frame >= action("return").toFrame;
    const querying = frame >= action("lookup").fromFrame;
    const resultY = g.database.y + g.databaseFirstRowBaseline + copy.matchedIndex * g.databaseRowGap - 10;
    return { queried, returned, queryProgress: progress("lookup"), requestVisible: frame >= action("send").fromFrame && frame < action("send").toFrame,
      request: pointOnOrthogonalRoute([[horizontalCenter(g.caller), g.sendY], [horizontalCenter(g.database), g.sendY]], progress("send")),
      resultVisible: queried, resultInTransit: queried && !returned,
      result: pointOnOrthogonalRoute([[horizontalCenter(g.database), resultY], [g.returnTurnX, resultY],
        [g.returnTurnX, g.returnY], [horizontalCenter(g.caller), g.returnY]], progress("return")),
      phase: !querying ? 0 : !queried ? 1 : returned ? 3 : 2,
      cue: !querying ? `请求携带明确的查询条件：${copy.query}` : !queried ? "数据库按编号查找匹配记录" : returned ? "调用方收到返回值，才能继续处理" : "匹配成功后，结果沿返回路径送回" };
  }
  const g = geometry.restore;
  const restored = frame >= action("restore").toFrame;
  const errorLocated = frame >= action("compare").toFrame;
  const restoring = frame >= action("restore").fromFrame;
  return { errorLocated, compareProgress: progress("compare"), comparing: frame >= action("compare").fromFrame && !errorLocated, restored,
    patchVisible: restoring && !restored,
    patch: pointOnOrthogonalRoute([[horizontalCenter(g.known), g.transferY], [horizontalCenter(g.current), g.transferY]], progress("restore")),
    sourceValue: copy.source, currentValue: restored ? copy.source : copy.invalid,
    phase: !errorLocated ? 0 : !restoring ? 1 : restored ? 3 : 2,
    cue: !errorLocated ? "对照已知可用版本，检查实际内容" : !restoring ? `发现差异：当前是“${copy.invalid}”` : restored ? `当前内容已恢复为“${copy.source}”` : "从已知版本恢复，不重新猜测内容" };
}
