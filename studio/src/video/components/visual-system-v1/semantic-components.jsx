import React from "react";

import { resolveVisualSystemV1Scene } from "./resolver.mjs";

const VisualSystemV1SemanticContext = React.createContext(null);

function semanticChild(children, attributes) {
  const child = React.Children.only(children);
  if (!React.isValidElement(child)) {
    throw new TypeError("语义组件必须包裹一个有效的 React 元素");
  }
  return React.cloneElement(child, attributes);
}

export function VisualSystemV1SemanticScene({ scene, children, style = {} }) {
  const resolved = resolveVisualSystemV1Scene(scene);
  return (
    <VisualSystemV1SemanticContext.Provider value={resolved}>
      <div
        data-visual-expression-version={resolved.visualPlan.schemaVersion}
        data-visual-expression-scene-id={resolved.visualPlan.sceneId}
        data-visual-expression-structure={resolved.visualPlan.structure}
        data-visual-expression-composition={resolved.visualPlan.compositionProfile}
        data-visual-system-profile={resolved.styleProfileId}
        style={{ position: "absolute", inset: 0, ...style }}
      >
        {children}
      </div>
    </VisualSystemV1SemanticContext.Provider>
  );
}

export function VisualSystemV1SemanticElement({ semanticId, children }) {
  const resolved = React.useContext(VisualSystemV1SemanticContext);
  if (!resolved) throw new Error("VisualSystemV1SemanticElement 必须位于语义场景内");
  const element = resolved.visualPlan.semanticElements.find((candidate) => candidate.id === semanticId);
  if (!element) throw new Error(`视觉元素没有绑定场景语义：${semanticId}`);
  return semanticChild(children, {
    "data-semantic-id": element.id,
    "data-semantic-role": element.semanticRole,
    "data-semantic-importance": element.importance,
    "data-semantic-claim-ids": element.claimIds.join(",")
  });
}

export function VisualSystemV1SemanticConnector({ relationId, children }) {
  const resolved = React.useContext(VisualSystemV1SemanticContext);
  if (!resolved) throw new Error("VisualSystemV1SemanticConnector 必须位于语义场景内");
  const relation = resolved.visualPlan.semanticRelations.find(
    (candidate) => candidate.id === relationId
  );
  if (!relation) throw new Error(`视觉连线没有绑定场景关系：${relationId}`);
  return semanticChild(children, {
    "data-semantic-relation-id": relation.id,
    "data-semantic-from": relation.from,
    "data-semantic-to": relation.to,
    "data-semantic-directed": String(relation.directed),
    "data-semantic-claim-ids": relation.claimIds.join(",")
  });
}
