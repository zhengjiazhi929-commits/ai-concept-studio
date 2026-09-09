import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [
  role,
  moduleUrl,
  workDirectory,
  attemptToken,
  videoPartPath,
  metadataPartPath
] = process.argv.slice(2);

const {
  LONG_REVIEW_RENDER_PARENT_BINDING_PROTOCOL,
  acquireLongReviewRenderJobLock,
  bindLongReviewRenderWorkerToParent
} = await import(moduleUrl);

if (role === "parent") {
  const lock = await acquireLongReviewRenderJobLock(workDirectory, {
    jobId: "parent-crash-fixture",
    token: attemptToken
  });
  lock.assertOwned();
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "worker",
      moduleUrl,
      workDirectory,
      attemptToken,
      videoPartPath,
      metadataPartPath
    ],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] }
  );
  child.send({
    protocol: LONG_REVIEW_RENDER_PARENT_BINDING_PROTOCOL,
    attemptToken
  });
  child.on("message", (message) => {
    if (message?.type !== "worker-ready") return;
    process.stdout.write(`${JSON.stringify({
      parentPid: process.pid,
      workerPid: message.workerPid
    })}\n`);
  });
  setInterval(() => lock.assertOwned(), 1_000);
} else if (role === "worker") {
  let resolveParentLost;
  const parentLost = new Promise((resolveLoss) => {
    resolveParentLost = resolveLoss;
  });
  const binding = bindLongReviewRenderWorkerToParent({
    attemptToken,
    onParentLost: resolveParentLost,
    handshakeTimeoutMs: 10_000
  });
  await binding.ready;
  binding.assertConnected();
  await Promise.all([
    writeFile(videoPartPath, "orphan-attempt-video", { flag: "wx" }),
    writeFile(metadataPartPath, "orphan-attempt-metadata", { flag: "wx" })
  ]);
  process.send({ type: "worker-ready", workerPid: process.pid });
  await parentLost;
  try {
    binding.assertConnected();
    throw new Error("orphan worker incorrectly retained parent binding");
  } catch (error) {
    if (error?.code !== "long_review_render_parent_lost") throw error;
  } finally {
    binding.dispose();
  }
} else {
  throw new Error(`unknown fixture role: ${role}`);
}
