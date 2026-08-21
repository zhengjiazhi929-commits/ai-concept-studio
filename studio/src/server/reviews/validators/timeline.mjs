import { reviewCheck } from "../checks.mjs";

export function validateTimelineForReview(episode) {
  const scenes = [...(episode.scenes ?? [])].sort((a, b) => a.start - b.start);
  const subtitles = [...(episode.subtitles ?? [])].sort((a, b) => a.start - b.start);
  const duration = Number(episode.render?.durationSeconds ?? scenes.at(-1)?.end ?? 0);
  let sceneCursor = 0;
  let sceneContinuous = scenes.length > 0;
  for (const scene of scenes) {
    if (Math.abs(scene.start - sceneCursor) > 0.001 || scene.end <= scene.start) {
      sceneContinuous = false;
    }
    sceneCursor = scene.end;
  }
  if (Math.abs(sceneCursor - duration) > 0.01) sceneContinuous = false;

  let subtitleCursor = 0;
  let subtitleContinuous = subtitles.length > 0;
  for (const subtitle of subtitles) {
    if (Math.abs(subtitle.start - subtitleCursor) > 0.2 || subtitle.end <= subtitle.start) {
      subtitleContinuous = false;
    }
    subtitleCursor = subtitle.end;
  }
  if (Math.abs(subtitleCursor - duration) > 0.35) subtitleContinuous = false;

  return [
    reviewCheck("scene-timeline", "场景时间轴连续", sceneContinuous, {
      actual: sceneCursor,
      expected: duration
    }),
    reviewCheck("subtitle-timeline", "字幕时间轴连续", subtitleContinuous, {
      actual: subtitleCursor,
      expected: duration
    })
  ];
}
