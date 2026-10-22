import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

test("full-revision voice is independent, bounded and uses synthetic PCM contracts", () => {
  const result = spawnSync(process.env.QA_PYTHON || "python3", ["-B",
    fileURLToPath(new URL("./explainer-full-revision-voice-python-contract.py", import.meta.url))],
  {encoding: "utf8", env: {...process.env, PYTHONDONTWRITEBYTECODE: "1"}});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
