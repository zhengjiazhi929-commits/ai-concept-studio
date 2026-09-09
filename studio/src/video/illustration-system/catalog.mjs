import { defineIllustrationSequence } from "../../shared/illustration-system-contract.mjs";

export const ILLUSTRATION_STYLE = Object.freeze({
  id: "mint-explanatory-objects-v1", status: "candidate", width: 1920, height: 1080,
  fps: 30, durationInFrames: 360, strokeWidth: 3, titleSize: 64, labelSize: 32,
  detailSize: 26, cornerRadius: 16, contentSafeArea: [140, 320, 1780, 850],
  watermark: "approved-v013-continuous", contentCards: "text-only",
  connectorPolicy: "orthogonal-only", approvalPolicy: "explicit-user-review-required"
});

const object = (id, kind, label, claimId) => ({ id, kind, label, claimIds: [claimId] });
const action = (id, kind, objectIds, claimId, fromFrame, toFrame) => ({
  id, kind, objectIds, claimIds: [claimId], fromFrame, toFrame
});
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const example = ({ id, compositionId, title, subtitle, goal, claimId, objects, actions, copy }) => Object.freeze({
  id, compositionId, status: "candidate", subtitle, copy: freeze(copy),
  definition: defineIllustrationSequence({ id, title, explanationGoal: goal, claimIds: [claimId],
    fps: 30, durationInFrames: 360, objects, actions })
});

export const ILLUSTRATION_EXAMPLES = Object.freeze([
  example({ id: "select-load", compositionId: "IllustrationSelectLoad",
    title: "选中之后，才加载完整内容", subtitle: "先匹配任务，再载入需要的步骤；其他材料仍留在目录里。",
    goal: "通过保留原文件、只复制命中内容进入上下文的连续动作，解释按需加载的含义。", claimId: "selected-content-only",
    objects: [object("catalog", "document", "候选材料", "selected-content-only"),
      object("copy", "document", "命中的完整内容", "selected-content-only"), object("context", "context", "上下文窗口", "selected-content-only")],
    actions: [action("match", "select", ["catalog"], "selected-content-only", 45, 90),
      action("load", "transfer", ["catalog", "copy", "context"], "selected-content-only", 150, 240),
      action("loaded", "reveal", ["context"], "selected-content-only", 240, 300)],
    copy: { task: "整理报告", documents: ["图片处理", "报告整理", "数据核对"], selectedIndex: 1, payload: "步骤 + 验收", context: "上下文窗口" }
  }),
  example({ id: "request-return", compositionId: "IllustrationRequestReturn",
    title: "请求送出去，结果带回来", subtitle: "查询条件到达数据库、匹配记录后，结果才返回调用方。",
    goal: "用带编号的请求包、匹配的数据行和返回值，解释工具调用不是文字卡片的单向跳转。", claimId: "query-before-result",
    objects: [object("caller", "context", "调用方", "query-before-result"), object("request", "packet", "请求", "query-before-result"),
      object("database", "database", "示例数据库", "query-before-result"), object("result", "packet", "结果", "query-before-result")],
    actions: [action("send", "transfer", ["caller", "request", "database"], "query-before-result", 45, 120),
      action("lookup", "query", ["request", "database"], "query-before-result", 120, 180),
      action("return", "transfer", ["database", "result", "caller"], "query-before-result", 180, 270),
      action("received", "reveal", ["caller", "result"], "query-before-result", 270, 315)],
    copy: { query: "A17", records: [["A16", "待处理"], ["A17", "已发货"], ["A18", "待处理"]], matchedIndex: 1 }
  }),
  example({ id: "validate-restore", compositionId: "IllustrationValidateRestore",
    title: "先定位差异，再恢复版本", subtitle: "明确哪一处不符合要求，再恢复已知可用的内容。",
    goal: "展示具体内容差异被校验定位、已知版本作为恢复来源、当前内容实际改变的因果顺序。", claimId: "validate-before-restore",
    objects: [object("known", "version", "已知可用版本", "validate-before-restore"),
      object("current", "version", "当前版本", "validate-before-restore"), object("diff", "comparison", "差异", "validate-before-restore")],
    actions: [action("compare", "compare", ["known", "current", "diff"], "validate-before-restore", 45, 90),
      action("locate", "reveal", ["diff"], "validate-before-restore", 90, 150),
      action("restore", "restore", ["known", "current"], "validate-before-restore", 165, 240),
      action("restored", "reveal", ["current"], "validate-before-restore", 240, 300)],
    copy: { source: "保留验收", invalid: "跳过验收", before: "读取材料", after: "输出报告" }
  })
]);

export function illustrationExample(id) {
  const found = ILLUSTRATION_EXAMPLES.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown illustration example: ${id}`);
  return found;
}
