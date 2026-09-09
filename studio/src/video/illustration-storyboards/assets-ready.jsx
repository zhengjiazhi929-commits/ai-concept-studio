import { useEffect, useState } from "react";
import { useDelayRender } from "remotion";

// A DOM component existing does not prove that its bitmap reached the capture.
// This gate waits on the actual visible watermark element, not a separate preload.
export function StoryboardAssetsReady({ phase }) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Storyboard font and visible logo decode"));
  useEffect(() => {
    let disposed = false;
    const ready = async () => {
      const image = document.querySelector("img[data-ai-watermark-raster-sequence]");
      if (!image) throw new Error("Storyboard watermark element is missing");
      await Promise.all([document.fonts.ready, image.decode()]);
      const expected = `frame-${String(phase).padStart(3, "0")}.png`;
      if (!image.complete || image.naturalWidth < 1 || !image.currentSrc.endsWith(expected)) {
        throw new Error("Storyboard watermark has not decoded the requested phase");
      }
      // Readiness only; neither callback changes the authored scene or clock.
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      if (!disposed) continueRender(handle);
    };
    ready().catch((error) => { if (!disposed) cancelRender(error); });
    return () => { disposed = true; continueRender(handle); };
  }, [phase, handle, continueRender, cancelRender]);
  return null;
}
