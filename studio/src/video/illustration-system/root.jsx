import React from "react";
import { Composition } from "remotion";
import { ILLUSTRATION_EXAMPLES, ILLUSTRATION_STYLE } from "./catalog.mjs";
import { IllustrationScene } from "./components.jsx";
import { EditorialScene } from "./editorial-scene.jsx";

export function IllustrationSystemRoot() {
  return <>{ILLUSTRATION_EXAMPLES.map((example) => <Composition key={example.id} id={example.compositionId}
    component={IllustrationScene} width={ILLUSTRATION_STYLE.width} height={ILLUSTRATION_STYLE.height}
    fps={example.definition.fps} durationInFrames={example.definition.durationInFrames} defaultProps={{ exampleId: example.id }} />)}
    <Composition id="EditorialSelectLoad" component={EditorialScene} width={1920} height={1080}
      fps={30} durationInFrames={600} defaultProps={{}} />
  </>;
}
