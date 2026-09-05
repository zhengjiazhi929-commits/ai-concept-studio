import {
  VISUAL_EXPRESSION_STYLE_POLICY,
  VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID,
  resolveVisualExpressionPlan,
  validateVisualExpressionScene
} from "../../../shared/visual-expression-contract.mjs";
import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";

const COLOR_ROLE_TOKENS = Object.freeze({
  canvas: "paper",
  surface: "paperWarm",
  "surface-muted": "windowChrome",
  "text-primary": "ink",
  "text-secondary": "muted",
  "line-primary": "lineStrong",
  "line-secondary": "line",
  "accent-primary": "mint",
  "accent-secondary": "purple",
  "state-success": "mintDeep",
  "state-warning": "purpleDeep",
  "state-error": "ink",
  "evidence-highlight": "mint"
});

const TYPOGRAPHY_ROLE_TOKENS = Object.freeze({
  headline: Object.freeze({
    fontSizePx: VISUAL_SYSTEM_V1.typography.headlineWidePx,
    fontWeight: VISUAL_SYSTEM_V1.typography.fontWeights.display
  }),
  supporting: Object.freeze({
    fontSizePx: VISUAL_SYSTEM_V1.typography.supportingWidePx,
    fontWeight: VISUAL_SYSTEM_V1.typography.fontWeights.supporting
  }),
  "stage-title": Object.freeze({
    fontSizePx: VISUAL_EXPRESSION_STYLE_POLICY.typography.minimumStageTitleFontPx,
    fontWeight: VISUAL_SYSTEM_V1.typography.fontWeights.sectionLabel
  }),
  "node-label": Object.freeze({
    fontSizePx: VISUAL_SYSTEM_V1.cardTypography.label.expandedPx,
    fontWeight: VISUAL_SYSTEM_V1.typography.fontWeights.primaryLabel
  }),
  "node-detail": Object.freeze({
    fontSizePx: VISUAL_EXPRESSION_STYLE_POLICY.typography.minimumBodyFontPx,
    fontWeight: VISUAL_SYSTEM_V1.typography.fontWeights.detail
  }),
  caption: Object.freeze({
    fontSizePx: VISUAL_EXPRESSION_STYLE_POLICY.typography.minimumBodyFontPx,
    fontWeight: VISUAL_SYSTEM_V1.typography.fontWeights.detail
  }),
  "evidence-label": Object.freeze({
    fontSizePx: VISUAL_EXPRESSION_STYLE_POLICY.typography.minimumBodyFontPx,
    fontWeight: VISUAL_SYSTEM_V1.typography.fontWeights.technicalLabel
  })
});

const LINE_ROLE_TOKENS = Object.freeze({
  boundary: Object.freeze({ widthPx: 2, colorRole: "line-secondary" }),
  "relationship-primary": Object.freeze({ widthPx: 3, colorRole: "line-primary" }),
  "relationship-secondary": Object.freeze({ widthPx: 2, colorRole: "line-secondary" }),
  annotation: Object.freeze({ widthPx: 1.5, colorRole: "line-secondary" })
});

export function visualSystemV1ColorToken(colorRole) {
  const tokenName = COLOR_ROLE_TOKENS[colorRole];
  if (!tokenName || !VISUAL_EXPRESSION_STYLE_POLICY.colorRoles.includes(colorRole)) {
    throw new TypeError(`visual-system-v1 不支持颜色角色：${colorRole}`);
  }
  return Object.freeze({ role: colorRole, tokenName, value: VISUAL_SYSTEM_V1.palette[tokenName] });
}

export function visualSystemV1TypographyToken(typographyRole) {
  const token = TYPOGRAPHY_ROLE_TOKENS[typographyRole];
  if (!token) throw new TypeError(`visual-system-v1 不支持字号角色：${typographyRole}`);
  return token;
}

export function visualSystemV1LineToken(lineRole) {
  const token = LINE_ROLE_TOKENS[lineRole];
  if (!token) throw new TypeError(`visual-system-v1 不支持线条角色：${lineRole}`);
  return Object.freeze({
    ...token,
    color: visualSystemV1ColorToken(token.colorRole).value
  });
}

export function resolveVisualSystemV1Scene(scene) {
  if (!scene || typeof scene !== "object") {
    throw new TypeError("visual-system-v1 场景必须是对象");
  }
  const visualPlan = scene.visualPlan ?? resolveVisualExpressionPlan({
    sceneId: scene.id,
    visualIntent: scene.visualIntent,
    styleProfileId: VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID
  });
  const review = validateVisualExpressionScene(
    { ...scene, visualPlan },
    { styleProfileId: VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID }
  );
  if (!review.valid) {
    const error = new Error(
      `场景 ${scene.id ?? "unknown"} 未通过 visual-system-v1：${review.issues
        .map((item) => item.code)
        .join("、")}`
    );
    error.name = "VisualSystemV1ResolutionError";
    error.issues = review.issues;
    throw error;
  }
  return Object.freeze({
    visualPlan,
    styleProfileId: VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID,
    shapeLanguage: VISUAL_EXPRESSION_STYLE_POLICY.shapeLanguage,
    depthMode: VISUAL_EXPRESSION_STYLE_POLICY.depthMode,
    paletteMode: VISUAL_EXPRESSION_STYLE_POLICY.paletteMode,
    fontFamily: VISUAL_SYSTEM_V1.typography.fontFamily,
    colors: Object.freeze(Object.fromEntries(
      VISUAL_EXPRESSION_STYLE_POLICY.colorRoles.map((role) => [role, visualSystemV1ColorToken(role)])
    )),
    typography: TYPOGRAPHY_ROLE_TOKENS,
    lines: LINE_ROLE_TOKENS,
    geometry: VISUAL_EXPRESSION_STYLE_POLICY.geometry,
    complexity: VISUAL_EXPRESSION_STYLE_POLICY.complexity,
    forbidden: VISUAL_EXPRESSION_STYLE_POLICY.forbidden
  });
}

export {
  COLOR_ROLE_TOKENS as VISUAL_SYSTEM_V1_COLOR_ROLE_TOKENS,
  LINE_ROLE_TOKENS as VISUAL_SYSTEM_V1_LINE_ROLE_TOKENS,
  TYPOGRAPHY_ROLE_TOKENS as VISUAL_SYSTEM_V1_TYPOGRAPHY_ROLE_TOKENS
};
