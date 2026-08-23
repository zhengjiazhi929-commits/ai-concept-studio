import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

import { getMotionLibraryItem } from "./catalog.mjs";
import {
  easeOutCubic,
  previewEntranceProgress,
  progressBetween,
  seamlessProgress,
  segmentChineseWords
} from "./motion.mjs";
import {
  CardArcEffect,
  CardCascadeStaggerEffect,
  CardLinearSpreadEffect,
  CircuitTraceDrawEffect,
  DominoChainEffect,
  FadeDownEffect,
  FadeInEffect,
  FadeUpEffect,
  HexagonLatticeDrawEffect,
  ModularTileSnapEffect,
  ScaleInEffect,
  SegmentedLinkStretchEffect,
  SlideLeftEffect,
  SlideRightEffect,
  TextRevealEffect,
  WordRevealEffect
} from "./components/entrance-flow.jsx";
import {
  ArcTracerEffect,
  BookmarkSavePillEffect,
  CardGlancePreviewEffect,
  CheckboxDrawEffect,
  FilterTagPillEffect,
  FormSubmitMorphEffect,
  MagneticDotsEffect,
  MorphActionPillEffect,
  MorphingBarsEffect,
  SegmentedStepBarEffect,
  SegmentedStepperDotsEffect,
  ShapeShiftGridEffect,
  SmoothDotShiftEffect,
  WaveformLoaderEffect
} from "./components/feedback-status.jsx";
import {
  MonoRoundedBarEffect,
  MonoRoundedLineEffect,
  MonoRoundedSankeyEffect,
  RadialIrisMaskEffect,
  SplitGateRevealEffect
} from "./components/data-transitions.jsx";

export const MOTION_LIBRARY_EFFECTS = Object.freeze({
  "fade-in": FadeInEffect,
  "fade-up": FadeUpEffect,
  "fade-down": FadeDownEffect,
  "slide-left": SlideLeftEffect,
  "slide-right": SlideRightEffect,
  "scale-in": ScaleInEffect,
  "text-reveal": TextRevealEffect,
  "word-reveal": WordRevealEffect,
  "card-linear-spread": CardLinearSpreadEffect,
  "card-cascade-stagger": CardCascadeStaggerEffect,
  "card-arc": CardArcEffect,
  "circuit-trace-draw": CircuitTraceDrawEffect,
  "hexagon-lattice-draw": HexagonLatticeDrawEffect,
  "modular-tile-snap": ModularTileSnapEffect,
  "segmented-link-stretch": SegmentedLinkStretchEffect,
  "domino-chain": DominoChainEffect,
  "filter-tag-pill": FilterTagPillEffect,
  "morph-action-pill": MorphActionPillEffect,
  "segmented-step-bar": SegmentedStepBarEffect,
  "segmented-stepper-dots": SegmentedStepperDotsEffect,
  "card-glance-preview": CardGlancePreviewEffect,
  "bookmark-save-pill": BookmarkSavePillEffect,
  "checkbox-draw": CheckboxDrawEffect,
  "form-submit-morph": FormSubmitMorphEffect,
  "smooth-dot-shift": SmoothDotShiftEffect,
  "magnetic-dots": MagneticDotsEffect,
  "arc-tracer": ArcTracerEffect,
  "morphing-bars": MorphingBarsEffect,
  "waveform-loader": WaveformLoaderEffect,
  "shape-shift-grid": ShapeShiftGridEffect,
  "mono-rounded-line": MonoRoundedLineEffect,
  "mono-rounded-bar": MonoRoundedBarEffect,
  "mono-rounded-sankey": MonoRoundedSankeyEffect,
  "split-gate-reveal": SplitGateRevealEffect,
  "radial-iris-mask": RadialIrisMaskEffect
});

export const MOTION_LIBRARY_EFFECT_IDS = Object.freeze(Object.keys(MOTION_LIBRARY_EFFECTS));

function isContinuous(item) {
  return item.previewLoop === "continuous-seamless";
}

export function MotionLibraryPrimitive({ effectId, progress = 1, cycle = 0 }) {
  const item = getMotionLibraryItem(effectId);
  const Effect = MOTION_LIBRARY_EFFECTS[effectId];
  if (!Effect) throw new TypeError(`动效尚未注册：${effectId}`);

  const props = isContinuous(item) ? { cycle } : { progress };
  if (effectId === "word-reveal") {
    props.words = segmentChineseWords("规则连接执行结果人工确认");
  }

  return <Effect {...props} />;
}

export function MotionLibraryEffect({
  effectId,
  startFrame = 0,
  durationInFrames,
  previewMode = false,
  style = {}
}) {
  const frame = useCurrentFrame();
  const video = useVideoConfig();
  const duration = Math.max(2, Math.round(durationInFrames ?? video.durationInFrames));
  const localFrame = Math.max(0, Math.min(duration - 1, frame - startFrame));
  const item = getMotionLibraryItem(effectId);
  const rawCycle = seamlessProgress(localFrame, duration);
  // Continuous effects use phase 0 again on the explicit proof frame so
  // properties such as SVG dash offsets are pixel-identical at the seam.
  const cycle = localFrame === duration - 1 ? 0 : rawCycle;
  const progress = previewMode
    ? previewEntranceProgress(localFrame, duration)
    : progressBetween(localFrame, 0, Math.max(1, Math.min(18, duration - 1)), easeOutCubic);

  return (
    <div
      data-motion-effect={effectId}
      data-motion-category={item.category}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", ...style }}
    >
      <MotionLibraryPrimitive effectId={effectId} progress={progress} cycle={cycle} />
    </div>
  );
}
