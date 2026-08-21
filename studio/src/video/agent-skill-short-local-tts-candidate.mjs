const TIMELINE_EPSILON = 0.001;

export const SHORT_LOCAL_TTS_EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
export const SHORT_LOCAL_TTS_DURATION_SECONDS = 60;
export const SHORT_LOCAL_TTS_SCENE_COUNT = 9;
export const SHORT_LOCAL_TTS_VOICE_ID = "zm_010";
export const SHORT_LOCAL_TTS_PACING_PROFILE_VERSION = "short-local-tts-pacing-v2";
export const SHORT_LOCAL_TTS_SEGMENT_PACING = Object.freeze({
  S03: Object.freeze({
    preferredSpeed: 0.75,
    targetTrailingSilenceSeconds: 1.65,
    minimumSpeed: 0.72,
    maximumEstimatedSpeed: 0.78,
    maximumSpeed: 0.78,
    maximumTrailingSilenceSeconds: 2,
    minimumExplicitPauseSeconds: 0.4,
    maximumExplicitPauseSeconds: 0.6,
    speechParts: Object.freeze([
      Object.freeze({
        text: "MCP 标准化 prompts、resources 和 tools ",
        pauseAfterSeconds: 0.5
      }),
      Object.freeze({
        text: "如何被外部系统暴露和调用。",
        pauseAfterSeconds: 0
      })
    ])
  }),
  S06: Object.freeze({
    preferredSpeed: 1.12,
    targetTrailingSilenceSeconds: 0.15,
    minimumSpeed: 1,
    maximumEstimatedSpeed: 1.18,
    maximumSpeed: 1.18,
    maximumTrailingSilenceSeconds: 0.35
  })
});
export const SHORT_LOCAL_TTS_NETWORK_GUARDS = Object.freeze([
  "socket.connect",
  "socket.connect_ex",
  "socket.create_connection",
  "socket.getaddrinfo",
  "socket.sendto"
]);

function fail(message) {
  throw new Error(`本地旁白试听候选无效：${message}`);
}

function sameTime(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= TIMELINE_EPSILON;
}

function narrationWithoutLayoutBreaks(value) {
  return String(value ?? "").replace(/[\r\n]/gu, "");
}

function assertContinuousTimeline(items, label, durationSeconds) {
  if (!Array.isArray(items) || items.length === 0) fail(`${label}为空`);
  let cursor = 0;
  for (const [index, item] of items.entries()) {
    if (!sameTime(item?.start, cursor)) {
      fail(`${label}[${index}] 未从 ${cursor} 秒连续开始`);
    }
    if (!Number.isFinite(item?.end) || item.end <= item.start) {
      fail(`${label}[${index}] 的结束时间无效`);
    }
    cursor = item.end;
  }
  if (!sameTime(cursor, durationSeconds)) {
    fail(`${label}未连续覆盖 ${durationSeconds} 秒`);
  }
}

function scriptNarration(episode) {
  const sections = episode?.production?.scriptDraft?.content?.sections;
  if (!Array.isArray(sections) || sections.length === 0) fail("当前脚本旁白为空");
  return sections.map((section) => String(section?.narration ?? "")).join("");
}

export function assertShortLocalTtsSpeechParts(segment) {
  if (segment?.speechParts === undefined) return 0;
  if (!Array.isArray(segment.speechParts) || segment.speechParts.length < 2) {
    fail(`${segment?.id ?? "未知分段"} speechParts 至少需要两段`);
  }
  let explicitPauseSeconds = 0;
  for (const [index, part] of segment.speechParts.entries()) {
    if (typeof part?.text !== "string" || part.text.length === 0) {
      fail(`${segment.id} speechParts[${index}] 文本为空`);
    }
    if (!Number.isFinite(part.pauseAfterSeconds) || part.pauseAfterSeconds < 0) {
      fail(`${segment.id} speechParts[${index}] 停顿无效`);
    }
    if (index === segment.speechParts.length - 1 && part.pauseAfterSeconds !== 0) {
      fail(`${segment.id} 最后一段 speechPart 后不能添加显式停顿`);
    }
    explicitPauseSeconds += part.pauseAfterSeconds;
  }
  if (segment.speechParts.map((part) => part.text).join("") !== segment.text) {
    fail(`${segment.id} speechParts 拼接文本与批准旁白不一致`);
  }
  if (
    !Number.isFinite(segment.minimumExplicitPauseSeconds)
    || !Number.isFinite(segment.maximumExplicitPauseSeconds)
    || explicitPauseSeconds < segment.minimumExplicitPauseSeconds - TIMELINE_EPSILON
    || explicitPauseSeconds > segment.maximumExplicitPauseSeconds + TIMELINE_EPSILON
  ) {
    fail(`${segment.id} 显式停顿不在批准范围内`);
  }
  return Number(explicitPauseSeconds.toFixed(3));
}

export function buildShortLocalTtsSegments(episode, voicePlan) {
  if (episode?.id !== SHORT_LOCAL_TTS_EPISODE_ID) {
    fail(`Episode 必须为 ${SHORT_LOCAL_TTS_EPISODE_ID}`);
  }
  if (voicePlan?.episodeId !== episode.id) fail("voice plan 未绑定当前 Episode");
  if (!sameTime(voicePlan?.durationSeconds, SHORT_LOCAL_TTS_DURATION_SECONDS)) {
    fail("voice plan 时长必须为 60 秒");
  }

  const scenes = episode.scenes;
  const subtitles = episode.subtitles;
  if (!Array.isArray(scenes) || scenes.length !== SHORT_LOCAL_TTS_SCENE_COUNT) {
    fail(`当前分镜必须正好包含 ${SHORT_LOCAL_TTS_SCENE_COUNT} 镜`);
  }
  for (const [index, scene] of scenes.entries()) {
    const expectedId = `S${String(index + 1).padStart(2, "0")}`;
    if (scene?.id !== expectedId) fail(`第 ${index + 1} 镜必须为 ${expectedId}`);
  }
  assertContinuousTimeline(scenes, "分镜", SHORT_LOCAL_TTS_DURATION_SECONDS);
  assertContinuousTimeline(subtitles, "字幕", SHORT_LOCAL_TTS_DURATION_SECONDS);

  let subtitleIndex = 0;
  const segments = scenes.map((scene) => {
    const sceneSubtitles = [];
    while (
      subtitleIndex < subtitles.length
      && subtitles[subtitleIndex].start < scene.end - TIMELINE_EPSILON
    ) {
      const subtitle = subtitles[subtitleIndex];
      if (subtitle.start < scene.start - TIMELINE_EPSILON) {
        fail(`${scene.id} 包含跨越镜头起点的字幕`);
      }
      if (subtitle.end > scene.end + TIMELINE_EPSILON) {
        fail(`${scene.id} 包含跨越镜头终点的字幕`);
      }
      if (typeof subtitle.text !== "string" || subtitle.text.length === 0) {
        fail(`${scene.id} 包含空字幕`);
      }
      sceneSubtitles.push(subtitle);
      subtitleIndex += 1;
    }
    if (sceneSubtitles.length === 0) fail(`${scene.id} 没有旁白字幕`);
    if (
      !sameTime(sceneSubtitles[0].start, scene.start)
      || !sameTime(sceneSubtitles.at(-1).end, scene.end)
    ) {
      fail(`${scene.id} 的字幕没有完整覆盖镜头时段`);
    }
    const pacing = SHORT_LOCAL_TTS_SEGMENT_PACING[scene.id] ?? {};
    const segment = {
      id: scene.id,
      start: scene.start,
      end: scene.end,
      preferredSpeed: pacing.preferredSpeed ?? 1,
      text: sceneSubtitles.map((subtitle) => subtitle.text).join(""),
      subtitleCount: sceneSubtitles.length,
      ...pacing
    };
    assertShortLocalTtsSpeechParts(segment);
    return segment;
  });
  if (subtitleIndex !== subtitles.length) fail("存在未归入九镜时段的字幕");

  const subtitleNarration = segments.map((segment) => segment.text).join("");
  const approvedScriptNarration = scriptNarration(episode);
  const plannedNarration = narrationWithoutLayoutBreaks(voicePlan.narration);
  if (subtitleNarration !== plannedNarration) {
    fail("字幕逐字内容与 voice plan 旁白不一致");
  }
  if (subtitleNarration !== approvedScriptNarration) {
    fail("字幕逐字内容与当前脚本旁白不一致");
  }

  return {
    episodeId: episode.id,
    durationSeconds: SHORT_LOCAL_TTS_DURATION_SECONDS,
    pacingProfileVersion: SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
    narration: subtitleNarration,
    segments
  };
}

export function assertShortLocalTtsRenderedSegments(plan, renderedSegments) {
  if (!Array.isArray(renderedSegments) || renderedSegments.length !== plan?.segments?.length) {
    fail("本地 TTS 返回的旁白段数与九镜方案不一致");
  }
  for (const [index, segment] of plan.segments.entries()) {
    const rendered = renderedSegments[index];
    const explicitPauseSeconds = assertShortLocalTtsSpeechParts(segment);
    if (
      rendered?.id !== segment.id
      || rendered?.start !== segment.start
      || rendered?.end !== segment.end
      || rendered?.text !== segment.text
    ) {
      fail(`${segment.id} 返回内容未与批准分镜逐段精确绑定`);
    }
    if (
      JSON.stringify(rendered.speechParts ?? null)
        !== JSON.stringify(segment.speechParts ?? null)
      || (segment.speechParts && (
        !Array.isArray(rendered.speechPartMetrics)
        || rendered.speechPartMetrics.length !== segment.speechParts.length
        || !segment.speechParts.every((part, partIndex) => (
          rendered.speechPartMetrics[partIndex]?.text === part.text
          && Math.abs(
            rendered.speechPartMetrics[partIndex]?.pauseAfterSeconds
              - part.pauseAfterSeconds
          ) <= 0.001
        ))
      ))
    ) {
      fail(`${segment.id} 返回的 speechParts 与显式停顿明细不一致`);
    }
    if (
      Number.isFinite(segment.minimumSpeed)
      && (!Number.isFinite(rendered.speed) || rendered.speed < segment.minimumSpeed - 0.001)
    ) {
      fail(`${segment.id} 返回语速低于 ${segment.minimumSpeed}`);
    }
    if (
      Number.isFinite(segment.maximumSpeed)
      && (!Number.isFinite(rendered.speed) || rendered.speed > segment.maximumSpeed + 0.001)
    ) {
      fail(`${segment.id} 返回语速超过 ${segment.maximumSpeed}`);
    }
    if (
      Number.isFinite(segment.maximumTrailingSilenceSeconds)
      && (
        !Number.isFinite(rendered.trailingSilenceSeconds)
        || rendered.trailingSilenceSeconds > segment.maximumTrailingSilenceSeconds + 0.001
      )
    ) {
      fail(`${segment.id} 返回尾静音超过 ${segment.maximumTrailingSilenceSeconds} 秒`);
    }
    if (
      !Number.isFinite(rendered.speechDurationSeconds)
      || rendered.speechDurationSeconds <= 0
      || !Number.isFinite(rendered.explicitPauseSeconds)
      || Math.abs(rendered.explicitPauseSeconds - explicitPauseSeconds) > 0.001
      || !Number.isFinite(rendered.durationSeconds)
      || Math.abs(
        rendered.durationSeconds
          - rendered.speechDurationSeconds
          - rendered.explicitPauseSeconds
      ) > 0.003
    ) {
      fail(`${segment.id} 返回的发声时长与显式停顿合同不一致`);
    }
  }
  return true;
}

export function nextShortLocalTtsCandidateVersion(files) {
  const highest = files.reduce((current, file) => {
    const match = /^short-local-tts-zm_010-v(\d{3})(?:\.wav|-manifest\.json|\.rendering\.wav)$/u.exec(
      file
    );
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return highest + 1;
}
