import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {promisify} from "node:util";
import test from "node:test";

import {V004D_PACING_BORDER_PROOF} from "../scripts/render-agent-skill-v004d-pacing-border-proof.mjs";

test("仅导入 v004d 合同不读取或解析本机 Homebrew 媒体工具", async () => {
  const moduleUrl = new URL("../scripts/render-agent-skill-v004d-pacing-border-proof.mjs", import.meta.url);
  const program = [
    "import assert from 'node:assert/strict';",
    "import {realpathSync} from 'node:fs';",
    "assert.equal(process.permission.has('fs.read', '/opt/homebrew/bin/ffmpeg'), false);",
    "assert.throws(() => realpathSync('/opt/homebrew/bin/ffmpeg'), (error) => ['ERR_ACCESS_DENIED', 'ENOENT'].includes(error.code));",
    `const {V004D_PACING_BORDER_PROOF: contract} = await import(${JSON.stringify(moduleUrl.href)});`,
    "process.stdout.write(JSON.stringify({proofOnly: contract.proofOnly, frames: contract.outputFrameCount}));"
  ].join("\n");
  const {stdout} = await promisify(execFile)(process.execPath, [
    "--permission",
    `--allow-fs-read=${resolve(import.meta.dirname, "..")}`,
    "--input-type=module",
    "--eval",
    program
  ], {timeout: 30_000});
  assert.deepEqual(JSON.parse(stdout), {proofOnly: true, frames: 522});
});

test("v004d 样片固定验证 S11 边框并同步提速所有时间媒体", async () => {
  const contract = V004D_PACING_BORDER_PROOF;
  assert.equal(contract.candidateName, "v004d-pacing-card-border-proof-v002");
  assert.equal(contract.globalStartFrame, 10_080);
  assert.equal(contract.globalEndFrameInclusive, 10_679);
  assert.equal(contract.sourceFrameCount, 600);
  assert.equal(contract.playbackRate, 1.15);
  assert.equal(contract.outputFrameCount, 522);
  assert.equal(contract.outputAudioSamples, 835_200);
  assert.equal(contract.outputDurationSeconds, 17.4);
  assert.equal(contract.temporaryVoice, true);
  assert.equal(contract.finalHumanRecording, false);
  assert.equal(contract.proofOnly, true);

  const source = await readFile(
    new URL("../scripts/render-agent-skill-v004d-pacing-border-proof.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /buildSynchronizedPacingFilterGraph/u);
  assert.match(source, /captions: "composited-before-retime"/u);
  assert.match(source, /concurrency: 1/u);
  assert.match(source, /assertLowPriority/u);
  assert.match(source, /atomicPublishDirectoryNoReplace/u);
  assert.match(source, /fullVideoDecodePassed: true/u);
  assert.match(source, /fullAudioDecodePassed: true/u);
  assert.doesNotMatch(source, /overwrite: true/u);
});
