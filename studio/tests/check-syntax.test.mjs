import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkSyntaxFiles,
  discoverSyntaxFiles
} from "../scripts/check-syntax.mjs";

test("syntax 门禁稳定发现文件、只解析不执行，并阻断语法错误", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acs syntax fixture "));
  const valid = join(directory, "a valid module.mjs");
  const invalid = join(directory, "z invalid module.mjs");
  try {
    await writeFile(valid, 'throw new Error("this module must never execute");\n', "utf8");
    await writeFile(invalid, "export const = 1;\n", "utf8");
    const files = await discoverSyntaxFiles([directory]);
    assert.deepEqual(files, [valid, invalid]);
    assert.deepEqual(await checkSyntaxFiles([valid]), { checked: 1 });
    await assert.rejects(
      checkSyntaxFiles([invalid]),
      /Syntax check failed/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
