function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const geometry = (elements) => deepFreeze({
  viewBox: "0 0 64 64",
  elements
});

export const AI_TECH_ICON_GEOMETRY = deepFreeze({
  "prompt-bubble": geometry([
    { type: "rect", x: 9, y: 11, width: 46, height: 34, rx: 9, colorSlot: "primary" },
    { type: "path", d: "M19 45v9l11-9", colorSlot: "primary" },
    { type: "line", x1: 19, y1: 23, x2: 45, y2: 23, colorSlot: "secondary" },
    { type: "line", x1: 19, y1: 32, x2: 38, y2: 32, colorSlot: "secondary" }
  ]),
  "document-sheet": geometry([
    { type: "path", d: "M16 8h23l10 10v38H16Z", colorSlot: "primary" },
    { type: "path", d: "M39 8v10h10", colorSlot: "secondary" },
    { type: "line", x1: 24, y1: 29, x2: 42, y2: 29, colorSlot: "secondary" },
    { type: "line", x1: 24, y1: 38, x2: 42, y2: 38, colorSlot: "secondary" },
    { type: "line", x1: 24, y1: 47, x2: 36, y2: 47, colorSlot: "secondary" }
  ]),
  "image-frame": geometry([
    { type: "rect", x: 8, y: 11, width: 48, height: 42, rx: 7, colorSlot: "primary" },
    { type: "circle", cx: 23, cy: 25, r: 5, colorSlot: "secondary" },
    { type: "path", d: "M13 47l13-13 9 8 7-7 9 12", colorSlot: "secondary" }
  ]),
  "audio-wave": geometry([
    { type: "line", x1: 10, y1: 27, x2: 10, y2: 37, colorSlot: "secondary" },
    { type: "line", x1: 20, y1: 20, x2: 20, y2: 44, colorSlot: "primary" },
    { type: "line", x1: 32, y1: 12, x2: 32, y2: 52, colorSlot: "primary" },
    { type: "line", x1: 44, y1: 19, x2: 44, y2: 45, colorSlot: "primary" },
    { type: "line", x1: 54, y1: 27, x2: 54, y2: 37, colorSlot: "secondary" }
  ]),
  "video-player": geometry([
    { type: "rect", x: 7, y: 12, width: 50, height: 40, rx: 8, colorSlot: "primary" },
    { type: "path", d: "M27 23l15 9-15 9Z", colorSlot: "secondary", fill: true }
  ]),
  "table-grid": geometry([
    { type: "rect", x: 8, y: 10, width: 48, height: 44, rx: 6, colorSlot: "primary" },
    { type: "line", x1: 8, y1: 23, x2: 56, y2: 23, colorSlot: "primary" },
    { type: "line", x1: 8, y1: 38, x2: 56, y2: 38, colorSlot: "secondary" },
    { type: "line", x1: 25, y1: 23, x2: 25, y2: 54, colorSlot: "secondary" },
    { type: "line", x1: 41, y1: 23, x2: 41, y2: 54, colorSlot: "secondary" }
  ]),
  "database-stack": geometry([
    { type: "ellipse", cx: 32, cy: 15, rx: 21, ry: 7, colorSlot: "primary" },
    { type: "path", d: "M11 15v17c0 4 9 7 21 7s21-3 21-7V15", colorSlot: "primary" },
    { type: "path", d: "M11 32v17c0 4 9 7 21 7s21-3 21-7V32", colorSlot: "primary" },
    { type: "path", d: "M11 27c0 4 9 7 21 7s21-3 21-7", colorSlot: "secondary" },
    { type: "path", d: "M11 44c0 4 9 7 21 7s21-3 21-7", colorSlot: "secondary" }
  ]),
  "knowledge-books": geometry([
    { type: "rect", x: 10, y: 12, width: 13, height: 40, rx: 3, colorSlot: "primary" },
    { type: "rect", x: 25.5, y: 9, width: 13, height: 43, rx: 3, colorSlot: "secondary" },
    { type: "path", d: "M41 13l11-2 5 39-12 2Z", colorSlot: "primary" },
    { type: "line", x1: 13, y1: 21, x2: 20, y2: 21, colorSlot: "secondary" },
    { type: "line", x1: 29, y1: 19, x2: 35, y2: 19, colorSlot: "primary" }
  ]),
  "retrieval-search": geometry([
    { type: "ellipse", cx: 26, cy: 26, rx: 15, ry: 15, colorSlot: "primary" },
    { type: "line", x1: 37, y1: 37, x2: 53, y2: 53, colorSlot: "primary" },
    { type: "line", x1: 18, y1: 22, x2: 34, y2: 22, colorSlot: "secondary" },
    { type: "line", x1: 18, y1: 30, x2: 29, y2: 30, colorSlot: "secondary" }
  ]),
  "vector-points": geometry([
    { type: "path", d: "M17 18l15 11 15-13M17 18l5 28 10-17 14 17", colorSlot: "secondary" },
    { type: "circle", cx: 17, cy: 18, r: 5, colorSlot: "primary", fill: true },
    { type: "circle", cx: 32, cy: 29, r: 5, colorSlot: "primary", fill: true },
    { type: "circle", cx: 47, cy: 16, r: 5, colorSlot: "primary", fill: true },
    { type: "circle", cx: 22, cy: 46, r: 5, colorSlot: "primary", fill: true },
    { type: "circle", cx: 46, cy: 46, r: 5, colorSlot: "primary", fill: true }
  ]),
  "context-window": geometry([
    { type: "rect", x: 8, y: 10, width: 48, height: 44, rx: 7, colorSlot: "primary" },
    { type: "line", x1: 8, y1: 20, x2: 56, y2: 20, colorSlot: "secondary" },
    { type: "path", d: "M22 29h-5v15h5M42 29h5v15h-5", colorSlot: "primary" },
    { type: "line", x1: 28, y1: 32, x2: 37, y2: 32, colorSlot: "secondary" },
    { type: "line", x1: 28, y1: 40, x2: 37, y2: 40, colorSlot: "secondary" }
  ]),
  "memory-chip": geometry([
    { type: "rect", x: 14, y: 14, width: 36, height: 36, rx: 7, colorSlot: "primary" },
    { type: "rect", x: 23, y: 23, width: 18, height: 18, rx: 3, colorSlot: "secondary" },
    { type: "path", d: "M21 8v6M32 8v6M43 8v6M21 50v6M32 50v6M43 50v6", colorSlot: "primary" },
    { type: "path", d: "M8 21h6M8 32h6M8 43h6M50 21h6M50 32h6M50 43h6", colorSlot: "primary" }
  ]),
  "model-layers": geometry([
    { type: "path", d: "M9 22l23-12 23 12-23 12Z", colorSlot: "primary" },
    { type: "path", d: "M11 32l21 11 21-11", colorSlot: "secondary" },
    { type: "path", d: "M11 42l21 11 21-11", colorSlot: "primary" }
  ]),
  "agent-node": geometry([
    { type: "circle", cx: 32, cy: 32, r: 11, colorSlot: "primary" },
    { type: "circle", cx: 12, cy: 17, r: 4, colorSlot: "secondary", fill: true },
    { type: "circle", cx: 52, cy: 17, r: 4, colorSlot: "secondary", fill: true },
    { type: "circle", cx: 32, cy: 55, r: 4, colorSlot: "secondary", fill: true },
    { type: "path", d: "M23 25L15 19M41 25l8-6M32 43v8", colorSlot: "primary" }
  ]),
  "tool-wrench": geometry([
    { type: "path", d: "M37 11a13 13 0 0 0-14 17L10 41a8 8 0 0 0 11 11l13-13a13 13 0 0 0 17-14l-9 9-8-2-2-8Z", colorSlot: "primary" },
    { type: "circle", cx: 16, cy: 46, r: 3, colorSlot: "secondary" }
  ]),
  "api-brackets": geometry([
    { type: "path", d: "M24 12h-7c-4 0-6 2-6 6v9c0 3-2 5-5 5 3 0 5 2 5 5v9c0 4 2 6 6 6h7", colorSlot: "primary" },
    { type: "path", d: "M40 12h7c4 0 6 2 6 6v9c0 3 2 5 5 5-3 0-5 2-5 5v9c0 4-2 6-6 6h-7", colorSlot: "primary" },
    { type: "circle", cx: 25, cy: 32, r: 3.5, colorSlot: "secondary", fill: true },
    { type: "circle", cx: 39, cy: 32, r: 3.5, colorSlot: "secondary", fill: true },
    { type: "line", x1: 28.5, y1: 32, x2: 35.5, y2: 32, colorSlot: "secondary" }
  ]),
  "mcp-bridge": geometry([
    { type: "rect", x: 8, y: 20, width: 18, height: 24, rx: 5, colorSlot: "primary" },
    { type: "rect", x: 38, y: 20, width: 18, height: 24, rx: 5, colorSlot: "primary" },
    { type: "path", d: "M26 27h12M26 37h12", colorSlot: "secondary" },
    { type: "circle", cx: 17, cy: 32, r: 3, colorSlot: "secondary", fill: true },
    { type: "circle", cx: 47, cy: 32, r: 3, colorSlot: "secondary", fill: true }
  ]),
  "workflow-nodes": geometry([
    { type: "rect", x: 8, y: 11, width: 18, height: 14, rx: 4, colorSlot: "primary" },
    { type: "rect", x: 38, y: 25, width: 18, height: 14, rx: 4, colorSlot: "primary" },
    { type: "rect", x: 8, y: 39, width: 18, height: 14, rx: 4, colorSlot: "primary" },
    { type: "path", d: "M26 18h6c4 0 6 3 6 7M38 39c0 5-2 7-6 7h-6", colorSlot: "secondary" }
  ]),
  "routing-branch": geometry([
    { type: "path", d: "M10 32h14c8 0 10-13 18-13h11", colorSlot: "primary" },
    { type: "path", d: "M24 32c8 0 10 13 18 13h11", colorSlot: "primary" },
    { type: "path", d: "M48 14l6 5-6 5M48 40l6 5-6 5", colorSlot: "secondary" },
    { type: "circle", cx: 10, cy: 32, r: 4, colorSlot: "secondary", fill: true }
  ]),
  "parallel-lanes": geometry([
    { type: "path", d: "M10 16h40l-6-6M50 16l-6 6", colorSlot: "primary" },
    { type: "path", d: "M10 32h40l-6-6M50 32l-6 6", colorSlot: "secondary" },
    { type: "path", d: "M10 48h40l-6-6M50 48l-6 6", colorSlot: "primary" }
  ]),
  "retry-cycle": geometry([
    { type: "path", d: "M49 20A21 21 0 0 0 15 17l-5 6", colorSlot: "primary" },
    { type: "path", d: "M10 13v10h10", colorSlot: "secondary" },
    { type: "path", d: "M15 44a21 21 0 0 0 34 3l5-6", colorSlot: "primary" },
    { type: "path", d: "M54 51V41H44", colorSlot: "secondary" }
  ]),
  "warning-triangle": geometry([
    { type: "path", d: "M32 9 57 53H7Z", colorSlot: "primary" },
    { type: "line", x1: 32, y1: 23, x2: 32, y2: 38, colorSlot: "secondary" },
    { type: "circle", cx: 32, cy: 46, r: 2.5, colorSlot: "secondary", fill: true }
  ]),
  "failure-cross": geometry([
    { type: "circle", cx: 32, cy: 32, r: 23, colorSlot: "primary" },
    { type: "line", x1: 23, y1: 23, x2: 41, y2: 41, colorSlot: "secondary" },
    { type: "line", x1: 41, y1: 23, x2: 23, y2: 41, colorSlot: "secondary" }
  ]),
  "human-approval-gate": geometry([
    { type: "path", d: "M15 10v44M49 10v44", colorSlot: "primary" },
    { type: "path", d: "M15 20h15M15 44h15", colorSlot: "secondary" },
    { type: "rect", x: 34, y: 22, width: 16, height: 20, rx: 4, colorSlot: "primary" },
    { type: "line", x1: 39, y1: 29, x2: 45, y2: 29, colorSlot: "secondary" },
    { type: "line", x1: 39, y1: 35, x2: 45, y2: 35, colorSlot: "secondary" }
  ]),
  "permission-lock": geometry([
    { type: "rect", x: 11, y: 27, width: 42, height: 29, rx: 7, colorSlot: "primary" },
    { type: "path", d: "M20 27v-7a12 12 0 0 1 24 0v7", colorSlot: "primary" },
    { type: "circle", cx: 32, cy: 40, r: 3, colorSlot: "secondary", fill: true },
    { type: "line", x1: 32, y1: 43, x2: 32, y2: 49, colorSlot: "secondary" }
  ]),
  "audit-clipboard": geometry([
    { type: "rect", x: 13, y: 11, width: 38, height: 45, rx: 6, colorSlot: "primary" },
    { type: "rect", x: 23, y: 8, width: 18, height: 9, rx: 4, colorSlot: "secondary" },
    { type: "circle", cx: 22, cy: 30, r: 2.5, colorSlot: "primary", fill: true },
    { type: "line", x1: 29, y1: 30, x2: 44, y2: 30, colorSlot: "secondary" },
    { type: "circle", cx: 22, cy: 43, r: 2.5, colorSlot: "primary", fill: true },
    { type: "line", x1: 29, y1: 43, x2: 44, y2: 43, colorSlot: "secondary" }
  ]),
  "version-history": geometry([
    { type: "circle", cx: 34, cy: 32, r: 20, colorSlot: "primary" },
    { type: "path", d: "M17 18H9v-8M10 18a27 27 0 0 1 42 2", colorSlot: "secondary" },
    { type: "path", d: "M34 21v12l9 6", colorSlot: "primary" }
  ])
});

export function aiTechIconGeometry(canonicalIconId) {
  const definition = AI_TECH_ICON_GEOMETRY[canonicalIconId];
  if (!definition) throw new TypeError(`未注册的 AI 技术图标几何：${String(canonicalIconId)}`);
  return definition;
}
