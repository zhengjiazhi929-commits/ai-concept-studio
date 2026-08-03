import { resolve } from "node:path";
import { trendSnapshotsRoot } from "../src/shared/paths.mjs";
import { importTrendSnapshot } from "../src/server/trends/store.mjs";

const snapshotName =
  process.argv.slice(2).find((argument) => argument !== "--") ||
  "2026-08-03-public-signal-snapshot.json";
const result = await importTrendSnapshot(resolve(trendSnapshotsRoot, snapshotName));
console.log(
  JSON.stringify(
    {
      ok: true,
      snapshotId: result.snapshotId,
      imported: result.imported,
      total: result.total
    },
    null,
    2
  )
);
