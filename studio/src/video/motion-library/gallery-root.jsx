import React from "react";
import { Composition, Folder } from "remotion";

import {
  MOTION_LIBRARY_CATEGORIES,
  MOTION_LIBRARY_ITEMS,
  motionLibraryItemsByCategory
} from "./catalog.mjs";
import { MotionLibraryPreview } from "./preview.jsx";

const byId = Object.fromEntries(MOTION_LIBRARY_ITEMS.map((item) => [item.id, item]));

export function calculateMotionPreviewMetadata({ props }) {
  const item = byId[props.effectId];
  if (!item) throw new TypeError(`未知预览动效：${props.effectId}`);
  return {
    durationInFrames: item.previewDurationInFrames,
    fps: item.fps,
    width: item.previewWidth,
    height: item.previewHeight,
    props
  };
}

export function MotionLibraryGalleryRoot() {
  return (
    <>
      {MOTION_LIBRARY_CATEGORIES.map((category) => (
        <Folder key={category.id} name={category.id}>
          {motionLibraryItemsByCategory(category.id).map((item) => (
            <Composition
              key={item.id}
              id={`Motion-${item.id}`}
              component={MotionLibraryPreview}
              durationInFrames={item.previewDurationInFrames}
              fps={item.fps}
              width={item.previewWidth}
              height={item.previewHeight}
              defaultProps={{ effectId: item.id }}
              calculateMetadata={calculateMotionPreviewMetadata}
            />
          ))}
        </Folder>
      ))}
    </>
  );
}
