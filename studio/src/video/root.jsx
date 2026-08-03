import React from "react";
import { Composition } from "remotion";
import { EpisodePreview } from "./episode-preview.jsx";

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
);
