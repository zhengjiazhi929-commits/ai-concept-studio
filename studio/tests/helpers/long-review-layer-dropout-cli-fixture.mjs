import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  enforcePublishedSingleFrameLayerDropoutGate
} from "../../scripts/qa-agent-skill-long-review-wide-v004.mjs";

const qaDirectory = resolve(process.argv[2] ?? "");
const expectedAnalysis = JSON.parse(await readFile(
  resolve(qaDirectory, "single-frame-aba-layer-dropout.json"),
  "utf8"
));

await enforcePublishedSingleFrameLayerDropoutGate({
  qaDirectory,
  expectedAnalysis
});
