export function longReviewSemanticRelationType(relation) {
  return relation?.semanticType ?? relation?.type ?? null;
}

export function longReviewSemanticGroupBounds(geometryById, nodeIds, safeArea) {
  if (!geometryById) return null;
  const members = nodeIds.flatMap((nodeId) => geometryById[nodeId] ? [geometryById[nodeId]] : []);
  if (members.length === 0) return null;
  return {
    left: Math.max(safeArea.left, Math.min(...members.map((item) => item.left)) - 18),
    right: Math.min(safeArea.right, Math.max(...members.map((item) => item.right)) + 18),
    top: Math.max(safeArea.top, Math.min(...members.map((item) => item.top)) - 34),
    bottom: Math.min(safeArea.bottom, Math.max(...members.map((item) => item.bottom)) + 16)
  };
}

function interpolateSemanticGroupBounds(previous, current, progress) {
  if (!previous) return current;
  if (!current) return previous;
  const normalized = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1));
  return Object.fromEntries(["left", "right", "top", "bottom"].map((key) => [
    key,
    previous[key] + (current[key] - previous[key]) * normalized
  ]));
}

export function longReviewResolvedSemanticGroupBounds(group, layout) {
  const progressiveBounds = group.boundsMode === "visible-members" &&
    layout.currentGeometryById != null;
  return progressiveBounds
    ? interpolateSemanticGroupBounds(
        longReviewSemanticGroupBounds(layout.previousGeometryById, group.nodeIds, layout.safeArea),
        longReviewSemanticGroupBounds(layout.currentGeometryById, group.nodeIds, layout.safeArea),
        layout.state.stageTransitionProgress
      )
    : longReviewSemanticGroupBounds(
        group.boundsMode === "visible-members"
          ? layout.geometryById
          : layout.fullGeometryById ?? layout.geometryById,
        group.nodeIds,
        layout.safeArea
      );
}

export function longReviewBoundaryContrastSourceGroup(spec, relation) {
  if (longReviewSemanticRelationType(relation) !== "contrasts-with") return null;
  return (spec.groups ?? []).find((group) =>
    group.visualForm === "full-outline" &&
    group.nodeIds.includes(relation.from) &&
    !group.nodeIds.includes(relation.to)
  ) ?? null;
}

export function longReviewIsBoundaryContrastTarget(spec, nodeId) {
  return spec.visualPlan.semanticRelations.some((relation) =>
    relation.to === nodeId && longReviewBoundaryContrastSourceGroup(spec, relation) != null
  );
}

export function longReviewBoundaryContrastRoute(spec, relation, layout) {
  const sourceGroup = longReviewBoundaryContrastSourceGroup(spec, relation);
  const target = layout.geometryById[relation.to];
  const bounds = sourceGroup == null
    ? null
    : longReviewResolvedSemanticGroupBounds(sourceGroup, layout);
  if (!bounds || !target) return null;
  if (target.centerX >= bounds.right) {
    return [
      { x: bounds.right, y: target.centerY },
      { x: target.left, y: target.centerY }
    ];
  }
  if (target.centerX <= bounds.left) {
    return [
      { x: bounds.left, y: target.centerY },
      { x: target.right, y: target.centerY }
    ];
  }
  if (target.centerY >= bounds.bottom) {
    return [
      { x: target.centerX, y: bounds.bottom },
      { x: target.centerX, y: target.top }
    ];
  }
  return [
    { x: target.centerX, y: bounds.top },
    { x: target.centerX, y: target.bottom }
  ];
}
