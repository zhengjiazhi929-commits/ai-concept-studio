import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createStudioServer } from "../src/server/app.mjs";

test("静态文件服务拒绝通过目录 symlink 读取允许根之外的文件", async () => {
  const servedOutputRoot = await mkdtemp(resolve(tmpdir(), "acs-static-root-"));
  const externalRoot = await mkdtemp(resolve(tmpdir(), "acs-static-private-"));
  const marker = "synthetic-private-static-marker";
  await writeFile(resolve(externalRoot, "secret.txt"), marker, "utf8");
  await symlink(externalRoot, resolve(servedOutputRoot, "escape"));
  const { server } = await createStudioServer({
    recoverOnStart: false,
    outputRoot: servedOutputRoot,
    readEpisode: async () => {
      throw new Error("static file test must not read an Episode");
    }
  });

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/outputs/escape/secret.txt`
    );
    const body = await response.text();

    assert.equal(response.status, 403);
    assert.equal(body.includes(marker), false);
  } finally {
    if (server.listening) {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
    await rm(servedOutputRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});
