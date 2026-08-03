import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromBundle = createRequire(
  "C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json"
);
const { chromium } = requireFromBundle("playwright");

const baselineModuleUrl = new URL(
  "../demo-checkpoints/baseline/server.mjs",
  import.meta.url
);
const outputDirectory = fileURLToPath(
  new URL("../captures/screen-selects/", import.meta.url)
);

await mkdir(outputDirectory, { recursive: true });

const { createAppServer } = await import(baselineModuleUrl);
const server = createAppServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
});

try {
  const page = await browser.newPage({
    viewport: { width: 1365, height: 900 },
    deviceScaleFactor: 1
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#customerRows tr").first().waitFor();
  await page.screenshot({
    path: `${outputDirectory}/demo-baseline-before-click.png`,
    fullPage: true,
    animations: "disabled"
  });

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/export") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "批量导出客户" }).click();
  const exportResponse = await responsePromise;
  await page.locator("#exportState").getByText("失败").waitFor();

  const state = await page.locator("#exportState").textContent();
  const notice = await page.locator("#exportNotice").textContent();

  await page.screenshot({
    path: `${outputDirectory}/demo-baseline-export-failed.png`,
    fullPage: true,
    animations: "disabled"
  });

  console.log(
    JSON.stringify(
      {
        baselineCommit: "d3ef196",
        responseStatus: exportResponse.status(),
        responseContentType: exportResponse.headers()["content-type"],
        pageState: state,
        pageNotice: notice,
        screenshots: [
          "demo-baseline-before-click.png",
          "demo-baseline-export-failed.png"
        ]
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
