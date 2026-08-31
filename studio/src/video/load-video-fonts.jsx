import "@fontsource-variable/noto-sans-sc/wght.css";
import { cancelRender, continueRender, delayRender } from "remotion";

import {
  VIDEO_FONT_PROBE_TEXT,
  VIDEO_SANS_FONT_FAMILY_NAME
} from "./font-system.mjs";

const fontLoadHandle = delayRender("Loading locked Noto Sans SC video font");
const probe = (weight) =>
  document.fonts.load(
    `${weight} 32px "${VIDEO_SANS_FONT_FAMILY_NAME}"`,
    VIDEO_FONT_PROBE_TEXT
  );

Promise.all([probe(400), probe(600), probe(800)])
  .then((loadedFaces) => {
    if (loadedFaces.some((faces) => faces.length === 0)) {
      throw new Error("锁定的 Noto Sans SC 视频字体未加载完整");
    }
    continueRender(fontLoadHandle);
  })
  .catch((error) => cancelRender(error));
