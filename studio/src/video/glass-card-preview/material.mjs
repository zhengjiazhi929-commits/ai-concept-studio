import { VISUAL_SYSTEM_V1 } from "../components/visual-system-v1/tokens.mjs";

const palette = VISUAL_SYSTEM_V1.palette;

// Candidate material only: production surfaces opt in after separate review.
export const GLASS_CARD_MATERIAL = Object.freeze({
  id: "mint-frosted-thin-v001",
  productionApproved: false,
  background: palette.paper,
  ink: palette.ink,
  secondary: "#53685E",
  accent: palette.mintDeep,
  radius: 46,
  blur: 14,
  titleSize: 48,
  bodySize: 36,
  padding: 46
});

export function frostedCardStyle({ width, minHeight, emphasis = false }) {
  if (!Number.isFinite(width) || width < 320 || width > 1800) throw new RangeError("Invalid glass card width");
  if (!Number.isFinite(minHeight) || minHeight < 180 || minHeight > 700) throw new RangeError("Invalid glass card minHeight");
  if (typeof emphasis !== "boolean") throw new TypeError("Glass card emphasis must be boolean");
  return {
    position: "relative",
    width,
    minHeight,
    boxSizing: "border-box",
    padding: GLASS_CARD_MATERIAL.padding,
    borderRadius: GLASS_CARD_MATERIAL.radius,
    border: "1.5px solid rgba(255,255,255,0.9)",
    background: emphasis
      ? "linear-gradient(125deg, rgba(248,255,251,0.76), rgba(206,237,224,0.52) 55%, rgba(233,250,241,0.58))"
      : "linear-gradient(125deg, rgba(255,255,255,0.76), rgba(248,253,250,0.35) 55%, rgba(222,241,231,0.38))",
    backdropFilter: "blur(14px) saturate(1.08)",
    WebkitBackdropFilter: "blur(14px) saturate(1.08)",
    boxShadow: "0 0 0 1px rgba(66,111,88,0.20), inset 0 2px 2px rgba(255,255,255,0.92), inset 0 -3px 6px rgba(60,105,82,0.08), 0 3px 5px rgba(35,69,52,0.04), 0 18px 36px rgba(35,69,52,0.10), 0 42px 78px -30px rgba(35,69,52,0.16)"
  };
}
