export const VISUAL_SYSTEM_V1_DEPTH_ROLES = Object.freeze([
  "active-node",
  "key-result",
  "human-confirmation"
]);

export const VISUAL_SYSTEM_V1 = Object.freeze({
  schemaVersion: "visual-system-v1",
  status: "review-candidate",
  fps: 30,
  formats: Object.freeze({
    wide: Object.freeze({ width: 1920, height: 1080, aspect: "16:9" }),
    vertical: Object.freeze({ width: 1080, height: 1920, aspect: "9:16" })
  }),
  balance: Object.freeze({
    flatPercent: 70,
    shallowDepthPercent: 30,
    primaryMintPercent: 80,
    secondaryPurplePercent: 20,
    maximumAccentColors: 2,
    maximumSimultaneousHighlights: 3,
    maximumDiagramNodes: 12
  }),
  defaults: Object.freeze({
    surfaceMode: "flat-only",
    sameLevelSurfaceUniform: true,
    shallowDepthOptInOnly: true,
    outputFormat: "wide-only",
    contentFrameMode: "open-canvas",
    largeContentWindowEnabled: false,
    topHeaderEnabled: false,
    subtitleColor: "#000000",
    subtitleMotion: "none"
  }),
  chapterProgress: Object.freeze({
    enabled: true,
    placement: "bottom",
    mode: "duration-proportional-segmented",
    segmentBreaks: true,
    labelFormat: "index-and-title",
    showDurationText: false,
    showElapsedTime: false,
    showTotalTime: false,
    themeColorCount: 1
  }),
  cardDeck: Object.freeze({
    mode: "fill-safe-viewport",
    compositionMode: "visible-node-count",
    sceneAdaptive: true,
    outputFormat: "wide-only",
    sameLevelEqualSize: true,
    contentVerticalAlignment: "center",
    safeLeftPx: 90,
    safeRightPx: 90,
    safeTopPx: 342,
    safeBottomPx: 837,
    copyClearancePx: 24,
    subtitleClearancePx: 24,
    contentFitRequired: true,
    minimumGapXPx: 36,
    maximumGapXPx: 56,
    gapYPx: 36,
    maximumSingleCardWidthPx: 920,
    maximumTwoColumnCardWidthPx: 760,
    maximumDefaultCardWidthPx: 620,
    minimumCardWidthPx: 240,
    minimumCardHeightPx: 219,
    maximumCardHeightPx: 520,
    singleRowMaximumItems: 5,
    maximumItems: 12
  }),
  cardTypography: Object.freeze({
    mode: "geometry-responsive-uniform-per-deck",
    sameLevelUniform: true,
    compactHeightPx: 229,
    expandedHeightPx: 494,
    compactWidthPx: 256,
    wideCompactWidthPx: 543,
    expandedWidthPx: 920,
    marker: Object.freeze({
      compactPx: 13,
      expandedPx: 16,
      wideCompactBoostPx: 1,
      wideExpandedBoostPx: 2,
      lineHeight: 1.2,
      letterSpacingEm: 0.08,
      maximumLines: 1
    }),
    label: Object.freeze({
      compactPx: 30,
      expandedPx: 42,
      wideCompactBoostPx: 2,
      wideExpandedBoostPx: 14,
      lineHeight: 1.12,
      letterSpacingEm: -0.025,
      maximumLines: 2
    }),
    detail: Object.freeze({
      compactPx: 18,
      expandedPx: 24,
      wideCompactBoostPx: 1,
      wideExpandedBoostPx: 4,
      lineHeight: 1.35,
      maximumLines: 2
    }),
    spacing: Object.freeze({
      markerTitleCompactPx: 11,
      markerTitleExpandedPx: 20,
      markerTitleWideCompactBoostPx: 1,
      markerTitleWideExpandedBoostPx: 4,
      titleDetailCompactPx: 7,
      titleDetailExpandedPx: 12,
      titleDetailWideExpandedBoostPx: 2,
      dotCompactPx: 8,
      dotExpandedPx: 10,
      dotWideExpandedBoostPx: 2,
      dotMarkerGapCompactPx: 10,
      dotMarkerGapExpandedPx: 12,
      dotMarkerGapWideExpandedBoostPx: 2
    })
  }),
  semanticNode: Object.freeze({
    marker: Object.freeze({
      fontSizePx: 15,
      minimumContainerHeightPx: 120
    }),
    standard: Object.freeze({
      informationCard: Object.freeze({
        labelFontSizePx: 32,
        detailFontSizePx: 20,
        horizontalPaddingPx: 26,
        compactHeightThresholdPx: 90,
        compactLabelFontSizePx: 30,
        compactDetailFontSizePx: 18,
        compactVerticalPaddingPx: 5
      }),
      openCanvas: Object.freeze({
        minimumLabelFontSizePx: 28,
        maximumLabelFontSizePx: 36,
        minimumDetailFontSizePx: 18,
        maximumDetailFontSizePx: 24,
        horizontalPaddingPx: 26
      }),
      labelLetterSpacingPx: -0.8,
      detailFontWeight: 620,
      detailLineHeight: 1.22
    }),
    longformEmphasis: Object.freeze({
      informationCard: Object.freeze({
        labelFontSizePx: 34,
        detailFontSizePx: 22,
        horizontalPaddingPx: 28,
        compactHeightThresholdPx: 124,
        compactLabelFontSizePx: 32,
        compactDetailFontSizePx: 20,
        compactVerticalPaddingPx: 6
      }),
      openCanvas: Object.freeze({
        minimumLabelFontSizePx: 32,
        maximumLabelFontSizePx: 36,
        minimumDetailFontSizePx: 22,
        maximumDetailFontSizePx: 24,
        horizontalPaddingPx: 26
      }),
      labelLetterSpacingPx: -0.8,
      detailFontWeight: 650,
      detailLineHeight: 1.26
    })
  }),
  palette: Object.freeze({
    paper: "#F2F6F3",
    paperWarm: "#F8FAF8",
    ink: "#14211D",
    muted: "#65716C",
    faint: "#8C9692",
    line: "#BDD0C8",
    lineStrong: "#8EB4A5",
    mint: "#43B891",
    mintDeep: "#17795D",
    mintSoft: "#D8F3E8",
    mintFace: "#BFE9D9",
    mintSide: "#82CBB1",
    purple: "#8067D9",
    purpleDeep: "#5B45AA",
    purpleSoft: "#E8E0FF",
    purpleSide: "#B7A8EA",
    window: "rgba(252, 254, 252, 0.76)",
    windowChrome: "rgba(247, 250, 248, 0.72)",
    whiteHighlight: "rgba(255, 255, 255, 0.88)"
  }),
  typography: Object.freeze({
    fontFamily: '"PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    headlineWidePx: 84,
    headlineVerticalPx: 68,
    supportingWidePx: 34,
    supportingVerticalPx: 32,
    subtitleWidePx: 46,
    subtitleVerticalPx: 42,
    subtitleSupportingWidePx: 36,
    subtitleSupportingVerticalPx: 34,
    subtitleLineHeight: 1.25,
    subtitleMaximumLines: 2
  }),
  wallpaper: Object.freeze({
    driftPeriodSeconds: 20,
    maximumDriftFraction: 0.015,
    maximumLuminanceDelta: 0.06,
    blurPx: 72,
    mintOpacity: 0.2,
    purpleOpacity: 0.08
  }),
  window: Object.freeze({
    wide: Object.freeze({
      x: 94,
      y: 98,
      width: 1732,
      height: 880,
      borderRadius: 24,
      topBarHeight: 56,
      contentPaddingX: 76,
      contentPaddingY: 58
    }),
    vertical: Object.freeze({
      x: 42,
      y: 128,
      width: 996,
      height: 1568,
      borderRadius: 30,
      topBarHeight: 64,
      contentPaddingX: 54,
      contentPaddingY: 68
    }),
    border: "rgba(95, 126, 113, 0.22)",
    shadow: "0 28px 72px rgba(40, 76, 62, 0.13), inset 0 1px 0 rgba(255,255,255,0.92)"
  }),
  depth: Object.freeze({
    roles: VISUAL_SYSTEM_V1_DEPTH_ROLES,
    available: true,
    enabledByDefault: false,
    maximumVisibleDepthPx: 2.5,
    hoverAmplitudePx: 2,
    surfaceShadow: "0 12px 24px rgba(35, 95, 73, 0.13)",
    contactShadow: "0 8px 16px rgba(29, 83, 63, 0.16)"
  }),
  motion: Object.freeze({
    textEnterFrames: 12,
    nodeSpringFrames: 18,
    cardReflowFrames: 8,
    cardFocusFrames: 12,
    nodeEnterTranslateYPx: 12,
    shallowDepthEnterFrames: 18,
    connectorDrawFrames: 14,
    sceneFadeFrames: 8,
    subtitleLeadFrames: 2,
    subtitleTailFrames: 8,
    hoverEnterFrame: 278,
    hoverHoldFrame: 288,
    hoverExitFrame: 292,
    hoverSettledFrame: 306,
    spring: Object.freeze({
      damping: 28,
      stiffness: 210,
      mass: 0.82,
      overshootClamping: true
    })
  }),
  forbidden: Object.freeze([
    "nested-content-window",
    "card-everything",
    "more-than-two-accent-colors",
    "outlined-subtitles",
    "subtitle-container",
    "continuous-floating",
    "css-animation",
    "css-transition",
    "battery-widget-geometry",
    "mixed-depth-on-same-level",
    "animated-subtitles",
    "default-vertical-output",
    "large-content-wrapper",
    "default-top-header",
    "chapter-duration-text"
  ])
});
