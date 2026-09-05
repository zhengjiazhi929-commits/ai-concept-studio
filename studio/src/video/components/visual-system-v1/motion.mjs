import { spring } from "remotion";

import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";

export function visualSystemV1Clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function visualSystemV1SmoothStep(value) {
  const progress = visualSystemV1Clamp01(value);
  return progress * progress * (3 - 2 * progress);
}

export function visualSystemV1ProgressAtFrame(frame, startFrame, durationInFrames) {
  if (!Number.isFinite(durationInFrames) || durationInFrames <= 0) {
    throw new TypeError("动效时长必须大于 0 帧");
  }
  if (durationInFrames === 1) return frame >= startFrame ? 1 : 0;
  if (frame <= startFrame) return 0;
  const endFrame = startFrame + durationInFrames - 1;
  if (frame >= endFrame) return 1;
  return visualSystemV1SmoothStep((frame - startFrame) / (durationInFrames - 1));
}

export function visualSystemV1TextMotionAtFrame(frame, startFrame) {
  const progress = visualSystemV1ProgressAtFrame(
    frame,
    startFrame,
    VISUAL_SYSTEM_V1.motion.textEnterFrames
  );
  return Object.freeze({
    progress,
    opacity: progress,
    translateY: (1 - progress) * 6,
    scale: 0.985 + progress * 0.015
  });
}

export function visualSystemV1ChapterRevealAtFrame(
  frame,
  revealStartFrame = null,
  durationInFrames = 8
) {
  const progress = revealStartFrame == null
    ? 1
    : visualSystemV1ProgressAtFrame(frame, revealStartFrame, durationInFrames);
  return Object.freeze({
    progress,
    opacity: progress,
    translateY: (1 - progress) * 4
  });
}

export function visualSystemV1SpringMotionAtFrame(frame, startFrame, fps = VISUAL_SYSTEM_V1.fps) {
  const localFrame = Math.max(0, frame - startFrame);
  const finalFrame = startFrame + VISUAL_SYSTEM_V1.motion.nodeSpringFrames - 1;
  const progress = frame <= startFrame
    ? 0
    : frame >= finalFrame
      ? 1
      : visualSystemV1Clamp01(spring({
        frame: localFrame,
        fps,
        durationInFrames: VISUAL_SYSTEM_V1.motion.nodeSpringFrames,
        config: VISUAL_SYSTEM_V1.motion.spring
      }));
  return Object.freeze({
    progress,
    opacity: progress,
    translateY: (1 - progress) * VISUAL_SYSTEM_V1.motion.nodeEnterTranslateYPx,
    scale: 0.985 + progress * 0.015
  });
}

export function visualSystemV1HoverProgressAtFrame(frame) {
  const motion = VISUAL_SYSTEM_V1.motion;
  if (frame < motion.hoverEnterFrame) return 0;
  if (frame < motion.hoverHoldFrame) {
    return visualSystemV1ProgressAtFrame(
      frame,
      motion.hoverEnterFrame,
      motion.hoverHoldFrame - motion.hoverEnterFrame
    );
  }
  if (frame < motion.hoverExitFrame) return 1;
  if (frame < motion.hoverSettledFrame) {
    return 1 - visualSystemV1ProgressAtFrame(
      frame,
      motion.hoverExitFrame,
      motion.hoverSettledFrame - motion.hoverExitFrame
    );
  }
  return 0;
}

export function visualSystemV1DepthMotionAtFrame(
  frame,
  startFrame,
  { fps = VISUAL_SYSTEM_V1.fps, hover = false } = {}
) {
  const enter = visualSystemV1SpringMotionAtFrame(frame, startFrame, fps);
  const hoverProgress = hover ? visualSystemV1HoverProgressAtFrame(frame) : 0;
  return Object.freeze({
    ...enter,
    hoverProgress,
    translateY: enter.translateY - hoverProgress * VISUAL_SYSTEM_V1.depth.hoverAmplitudePx,
    depthPx: enter.progress * VISUAL_SYSTEM_V1.depth.maximumVisibleDepthPx
  });
}

export function visualSystemV1ConnectorMotionAtFrame(frame, startFrame) {
  const progress = visualSystemV1ProgressAtFrame(
    frame,
    startFrame,
    VISUAL_SYSTEM_V1.motion.connectorDrawFrames
  );
  return Object.freeze({
    progress,
    opacity: progress,
    dashOffset: 1 - progress,
    arrowOpacity: visualSystemV1ProgressAtFrame(
      frame,
      startFrame + VISUAL_SYSTEM_V1.motion.connectorDrawFrames - 4,
      4
    )
  });
}

export function visualSystemV1ChapterProgressAtFrame(frame, chapters) {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new TypeError("章节进度至少需要一个连续章节");
  }
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (
      !Number.isInteger(chapter.startFrame) ||
      !Number.isInteger(chapter.endFrame) ||
      chapter.endFrame <= chapter.startFrame ||
      (index > 0 && chapter.startFrame !== chapters[index - 1].endFrame)
    ) {
      throw new TypeError("章节进度必须使用连续的左闭右开整数帧区间");
    }
  }
  const segments = chapters.map((chapter) => {
    if (frame < chapter.startFrame) {
      return Object.freeze({ id: chapter.id, status: "future", progress: 0 });
    }
    if (frame >= chapter.endFrame) {
      return Object.freeze({ id: chapter.id, status: "done", progress: 1 });
    }
    const durationInFrames = chapter.endFrame - chapter.startFrame;
    return Object.freeze({
      id: chapter.id,
      status: "active",
      progress: visualSystemV1Clamp01(
        (frame - chapter.startFrame) / (durationInFrames - 1)
      )
    });
  });
  return Object.freeze({
    activeIndex: segments.findIndex((segment) => segment.status === "active"),
    overallProgress: visualSystemV1Clamp01(
      (frame - chapters[0].startFrame) /
        (chapters.at(-1).endFrame - chapters[0].startFrame - 1)
    ),
    segments: Object.freeze(segments)
  });
}

export function visualSystemV1SceneOpacityAtFrame(
  frame,
  { startFrame, endFrame, fadeFrames = VISUAL_SYSTEM_V1.motion.sceneFadeFrames }
) {
  if (frame < startFrame || frame >= endFrame) return 0;
  const fadeIn = visualSystemV1ProgressAtFrame(frame, startFrame, fadeFrames);
  const fadeOut = 1 - visualSystemV1ProgressAtFrame(frame, endFrame - fadeFrames, fadeFrames);
  return Math.min(fadeIn, fadeOut);
}

export function visualSystemV1SequentialSceneOpacityAtFrame(
  frame,
  { startFrame, endFrame, fadeFrames = VISUAL_SYSTEM_V1.motion.sceneFadeFrames }
) {
  if (!Number.isInteger(fadeFrames) || fadeFrames < 2 || fadeFrames % 2 !== 0) {
    throw new TypeError("顺序场景淡化必须使用不小于 2 的偶数帧数");
  }
  if (frame < startFrame || frame >= endFrame) return 0;
  const halfFadeFrames = fadeFrames / 2;
  const fadeIn = startFrame < 0
    ? 1
    : visualSystemV1ProgressAtFrame(
      frame,
      startFrame + halfFadeFrames - 1,
      halfFadeFrames
    );
  const fadeOut = 1 - visualSystemV1ProgressAtFrame(
    frame,
    endFrame - fadeFrames,
    halfFadeFrames
  );
  return Math.min(fadeIn, fadeOut);
}

export function visualSystemV1WallpaperMotionAtFrame(frame, width, height, fps = VISUAL_SYSTEM_V1.fps) {
  const periodFrames = VISUAL_SYSTEM_V1.wallpaper.driftPeriodSeconds * fps;
  const phase = (2 * Math.PI * (((frame % periodFrames) + periodFrames) % periodFrames)) / periodFrames;
  const maximumX = width * VISUAL_SYSTEM_V1.wallpaper.maximumDriftFraction;
  const maximumY = height * VISUAL_SYSTEM_V1.wallpaper.maximumDriftFraction;
  return Object.freeze({
    mint: Object.freeze({
      x: Math.cos(phase) * maximumX * 0.72,
      y: Math.sin(phase) * maximumY * 0.48
    }),
    purple: Object.freeze({
      x: Math.cos(phase + Math.PI) * maximumX * 0.36,
      y: Math.sin(phase + Math.PI) * maximumY * 0.3
    })
  });
}
