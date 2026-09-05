export const TECHNICAL_ARTIFACT_PROFILE_KINDS = Object.freeze([
  "bounded-resource-artifact",
  "layered-runtime-map",
  "decision-field",
  "evidence-lifecycle-ledger"
]);

export const TECHNICAL_ARTIFACT_PROFILE_POLICY = Object.freeze({
  minimumSafeWidthRatio: 0.6,
  minimumSafeHeightRatio: 0.45,
  minimumZones: 2,
  maximumZones: 4,
  maximumZoneLabelGraphemes: 8,
  revealMode: "anchor-bound",
  decorativeIconsAllowed: false
});

function unique(values) {
  return [...new Set(values)];
}

function assertNonEmptyString(value, label) {
  if (!(typeof value === "string" && value.trim().length > 0)) {
    throw new TypeError(`${label} 必须是非空文字`);
  }
}

export function defineTechnicalArtifactProfile({
  kind,
  semanticPurpose,
  zones,
  minimumSafeWidthRatio = TECHNICAL_ARTIFACT_PROFILE_POLICY.minimumSafeWidthRatio,
  minimumSafeHeightRatio = TECHNICAL_ARTIFACT_PROFILE_POLICY.minimumSafeHeightRatio
}) {
  if (!TECHNICAL_ARTIFACT_PROFILE_KINDS.includes(kind)) {
    throw new TypeError(`未知技术工件类型：${kind}`);
  }
  assertNonEmptyString(semanticPurpose, `${kind}/semanticPurpose`);
  if (
    !Number.isFinite(minimumSafeWidthRatio) ||
    minimumSafeWidthRatio < TECHNICAL_ARTIFACT_PROFILE_POLICY.minimumSafeWidthRatio ||
    minimumSafeWidthRatio > 1
  ) {
    throw new RangeError(`${kind} 的技术工件宽度覆盖率不足`);
  }
  if (
    !Number.isFinite(minimumSafeHeightRatio) ||
    minimumSafeHeightRatio < TECHNICAL_ARTIFACT_PROFILE_POLICY.minimumSafeHeightRatio ||
    minimumSafeHeightRatio > 1
  ) {
    throw new RangeError(`${kind} 的技术工件高度覆盖率不足`);
  }
  if (
    !Array.isArray(zones) ||
    zones.length < TECHNICAL_ARTIFACT_PROFILE_POLICY.minimumZones ||
    zones.length > TECHNICAL_ARTIFACT_PROFILE_POLICY.maximumZones
  ) {
    throw new TypeError(
      `${kind} 必须声明 ${TECHNICAL_ARTIFACT_PROFILE_POLICY.minimumZones}–` +
      `${TECHNICAL_ARTIFACT_PROFILE_POLICY.maximumZones} 个语义区`
    );
  }
  const normalizedZones = zones.map((zone, index) => {
    assertNonEmptyString(zone?.id, `${kind}/zones[${index}].id`);
    assertNonEmptyString(zone?.label, `${kind}/${zone?.id}.label`);
    if (Array.from(zone.label).length > TECHNICAL_ARTIFACT_PROFILE_POLICY.maximumZoneLabelGraphemes) {
      throw new RangeError(`${kind}/${zone.id} 的区名过长`);
    }
    if (!Array.isArray(zone.anchorNodeIds) || zone.anchorNodeIds.length === 0) {
      throw new TypeError(`${kind}/${zone.id} 必须绑定真实语义节点`);
    }
    if (unique(zone.anchorNodeIds).length !== zone.anchorNodeIds.length) {
      throw new TypeError(`${kind}/${zone.id} 重复绑定同一语义节点`);
    }
    return Object.freeze({
      id: zone.id,
      label: zone.label,
      anchorNodeIds: Object.freeze([...zone.anchorNodeIds]),
      revealMode: TECHNICAL_ARTIFACT_PROFILE_POLICY.revealMode
    });
  });
  const zoneIds = normalizedZones.map((zone) => zone.id);
  if (unique(zoneIds).length !== zoneIds.length) {
    throw new TypeError(`${kind} 的语义区 id 必须唯一`);
  }
  const anchorNodeIds = normalizedZones.flatMap((zone) => zone.anchorNodeIds);
  if (unique(anchorNodeIds).length !== anchorNodeIds.length) {
    throw new TypeError(`${kind} 的同一节点只能归属一个技术工件语义区`);
  }
  return Object.freeze({
    schemaVersion: "technical-artifact-profile-v1",
    kind,
    semanticPurpose: semanticPurpose.trim(),
    anchorNodeIds: Object.freeze(anchorNodeIds),
    zones: Object.freeze(normalizedZones),
    minimumSafeWidthRatio,
    minimumSafeHeightRatio,
    revealMode: TECHNICAL_ARTIFACT_PROFILE_POLICY.revealMode,
    decorativeIconsAllowed: TECHNICAL_ARTIFACT_PROFILE_POLICY.decorativeIconsAllowed
  });
}

export function validateTechnicalArtifactProfile(profile, nodeIds) {
  if (profile == null) return Object.freeze({ valid: true, issues: Object.freeze([]) });
  const availableNodeIds = new Set(nodeIds);
  const issues = [];
  if (profile.schemaVersion !== "technical-artifact-profile-v1") {
    issues.push("schema-version");
  }
  if (!TECHNICAL_ARTIFACT_PROFILE_KINDS.includes(profile.kind)) {
    issues.push("unknown-kind");
  }
  if (profile.revealMode !== TECHNICAL_ARTIFACT_PROFILE_POLICY.revealMode) {
    issues.push("future-copy-must-not-preload");
  }
  if (profile.decorativeIconsAllowed !== false) {
    issues.push("decorative-icons-not-allowed");
  }
  for (const anchorNodeId of profile.anchorNodeIds ?? []) {
    if (!availableNodeIds.has(anchorNodeId)) issues.push(`unknown-anchor:${anchorNodeId}`);
  }
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}

export function technicalArtifactBounds(safeArea, profile) {
  if (!safeArea || !profile) throw new TypeError("技术工件布局需要安全区与 profile");
  const width = safeArea.width;
  const height = safeArea.height;
  return Object.freeze({
    x: safeArea.left,
    y: safeArea.top,
    left: safeArea.left,
    top: safeArea.top,
    width,
    height,
    right: safeArea.left + width,
    bottom: safeArea.top + height,
    safeWidthRatio: 1,
    safeHeightRatio: 1,
    meetsCoverage:
      width > 0 &&
      height > 0 &&
      1 >= profile.minimumSafeWidthRatio &&
      1 >= profile.minimumSafeHeightRatio
  });
}

export function technicalArtifactZoneProgress(zone, nodeVisibilityProgress = {}) {
  return Math.max(
    0,
    ...zone.anchorNodeIds.map((nodeId) => Number(nodeVisibilityProgress[nodeId]) || 0)
  );
}

export function technicalArtifactRailStartX(zone, labelBounds, gap = 24) {
  if (!zone?.anchors?.length || !labelBounds) {
    throw new TypeError("技术工件轨道需要节点锚点与标签边界");
  }
  const firstAnchorX = Math.min(...zone.anchors.map((anchor) => anchor.centerX));
  const labelRight = labelBounds.left + labelBounds.width;
  return Math.max(firstAnchorX, labelRight + gap);
}

function localGeometry(geometry, safeArea) {
  return Object.freeze({
    left: geometry.left - safeArea.left,
    top: geometry.top - safeArea.top,
    right: geometry.right - safeArea.left,
    bottom: geometry.bottom - safeArea.top,
    width: geometry.width,
    height: geometry.height,
    centerX: geometry.centerX - safeArea.left,
    centerY: geometry.centerY - safeArea.top
  });
}

function unionGeometry(geometries) {
  const left = Math.min(...geometries.map((geometry) => geometry.left));
  const top = Math.min(...geometries.map((geometry) => geometry.top));
  const right = Math.max(...geometries.map((geometry) => geometry.right));
  const bottom = Math.max(...geometries.map((geometry) => geometry.bottom));
  return Object.freeze({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  });
}

export function technicalArtifactLayout({ profile, safeArea, geometryById }) {
  const bounds = technicalArtifactBounds(safeArea, profile);
  const zones = profile.zones.map((zone) => {
    const anchors = zone.anchorNodeIds.map((nodeId) => {
      const geometry = geometryById[nodeId];
      if (!geometry) throw new Error(`${profile.kind}/${zone.id} 缺少 ${nodeId} 的稳定几何`);
      return Object.freeze({ nodeId, ...localGeometry(geometry, safeArea) });
    });
    return Object.freeze({
      ...zone,
      anchors: Object.freeze(anchors),
      bounds: unionGeometry(anchors)
    });
  });
  const rowDividers = zones.slice(0, -1).map((zone, index) =>
    (zone.bounds.bottom + zones[index + 1].bounds.top) / 2
  );
  const columnDividers = zones.slice(0, -1).map((zone, index) =>
    (zone.bounds.right + zones[index + 1].bounds.left) / 2
  );
  const labelBounds = zones.map((zone, index) => {
    if (profile.kind === "decision-field") {
      return Object.freeze({
        left: zone.bounds.left,
        top: 12,
        width: zone.bounds.width,
        height: 28,
        textAlign: "center"
      });
    }
    if (profile.kind === "evidence-lifecycle-ledger") {
      const railY = index === 0
        ? Math.max(24, zone.bounds.top - 27)
        : (zones[index - 1].bounds.bottom + zone.bounds.top) / 2;
      return Object.freeze({ left: 12, top: railY - 14, width: 150, height: 28, textAlign: "left" });
    }
    return Object.freeze({
      left: 12,
      top: zone.bounds.centerY - 14,
      width: Math.max(96, Math.min(144, zone.bounds.left - 24)),
      height: 28,
      textAlign: "left"
    });
  });
  return Object.freeze({
    bounds,
    zones: Object.freeze(zones),
    rowDividers: Object.freeze(rowDividers),
    columnDividers: Object.freeze(columnDividers),
    labelBounds: Object.freeze(labelBounds)
  });
}
