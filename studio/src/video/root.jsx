import React from "react";
import { Composition } from "remotion";
import { EpisodePreview } from "./episode-preview.jsx";
import { VisualSystemSample } from "./visual-system-sample.jsx";
import {
  AgentSkillVisualProof,
  LOCAL_TTS_VISUAL_PROOF_AUDIO
} from "./agent-skill-visual-proof.jsx";
import {
  VISUAL_PROOF_DURATION_SECONDS,
  VISUAL_PROOF_FPS
} from "./agent-skill-visual-proof-plan.mjs";

const defaultEpisode = {
  title: "AI Concept Studio",
  render: { width: 540, height: 960, fps: 15, durationSeconds: 36 },
  scenes: [
    {
      id: "default",
      start: 0,
      end: 36,
      type: "title",
      title: "AI Concept Studio",
      subtitle: "等待一期数据"
    }
  ],
  subtitles: []
};

export const RemotionRoot = () => (
  <>
    <Composition
      id="ConceptPreview"
      component={EpisodePreview}
      durationInFrames={540}
      fps={15}
      width={540}
      height={960}
      defaultProps={{ episode: defaultEpisode }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.round(
          props.episode.render.durationSeconds * props.episode.render.fps
        ),
        fps: props.episode.render.fps,
        width: props.episode.render.width,
        height: props.episode.render.height
      })}
    />
    <Composition
      id="VisualSystemSampleWide"
      component={VisualSystemSample}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="VisualSystemSampleVertical"
      component={VisualSystemSample}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="AgentSkillVisualProof"
      component={AgentSkillVisualProof}
      durationInFrames={VISUAL_PROOF_DURATION_SECONDS * VISUAL_PROOF_FPS}
      fps={VISUAL_PROOF_FPS}
      width={540}
      height={960}
    />
    <Composition
      id="AgentSkillLocalTtsVisualProof"
      component={AgentSkillVisualProof}
      durationInFrames={VISUAL_PROOF_DURATION_SECONDS * VISUAL_PROOF_FPS}
      fps={VISUAL_PROOF_FPS}
      width={540}
      height={960}
      defaultProps={{
        audioPublicPath: LOCAL_TTS_VISUAL_PROOF_AUDIO,
        subtitleTrack: "local-tts-zm-010"
      }}
    />
  </>
);
