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
  const validJsx = join(directory, "b valid component.jsx");
  const validTsx = join(directory, "c valid component.tsx");
  const invalid = join(directory, "z invalid component.tsx");
  try {
    await writeFile(valid, 'throw new Error("this module must never execute");\n', "utf8");
    await writeFile(validJsx, "export const View = () => <main>ok</main>;\n", "utf8");
    await writeFile(
      validTsx,
      "type Props = {label: string}; export const View = ({label}: Props) => <main>{label}</main>;\n",
      "utf8"
    );
    await writeFile(invalid, "export const View = () => <main>;\n", "utf8");
    const files = await discoverSyntaxFiles([directory]);
    assert.deepEqual(files, [valid, validJsx, validTsx, invalid]);
    assert.deepEqual(await checkSyntaxFiles([valid, validJsx, validTsx]), { checked: 3 });
    await assert.rejects(
      checkSyntaxFiles([invalid]),
      /Syntax check failed/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
