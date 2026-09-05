import { access } from "node:fs/promises";
import { upsertTrendSignals } from "../../src/server/trends/store.mjs";

const [trendsRoot, barrierPath, rawIndex] = process.argv.slice(2);
const index = Number.parseInt(rawIndex, 10);

while (true) {
  try {
    await access(barrierPath);
    break;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
}

await upsertTrendSignals(
  [
    {
      id: `cross-process-${index}`,
      creatorId: "douyin-qiu-shui",
      title: `cross process unique signal ${index}`,
      sourceUrl: `https://example.test/trends/cross-process-${index}`,
      publishedAt: `2026-08-${String(4 + index).padStart(2, "0")}T00:00:00+08:00`,
      observedAt: "2026-08-31T12:00:00+08:00",
      datePrecision: "exact",
      angle: "mechanism",
      conceptIds: ["agent-skill"],
      sourceKind: "test-fixture"
    }
  ],
  { trendsRoot }
);
