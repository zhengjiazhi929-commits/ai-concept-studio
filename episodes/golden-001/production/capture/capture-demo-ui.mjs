import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromBundle = createRequire(
  "C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json"
);
const { chromium } = requireFromBundle("playwright");

const demoModuleUrl = new URL(
  "../../../../demo/agentic-coding-saas/server.mjs",
  import.meta.url
);
const outputDirectory = fileURLToPath(
  new URL("../captures/screen-selects/", import.meta.url)
);

await mkdir(outputDirectory, { recursive: true });

const { createAppServer } = await import(demoModuleUrl);
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
    path: `${outputDirectory}/demo-final-before-export.png`,
    fullPage: true,
    animations: "disabled"
  });

  await page.locator("#roleSelect").selectOption("viewer");
  await page.getByRole("button", { name: "批量导出客户" }).click();
  await page.getByText("仅管理员可以创建导出任务").waitFor();
  await page.screenshot({
    path: `${outputDirectory}/demo-viewer-denied.png`,
    fullPage: true,
    animations: "disabled"
  });

  await page.locator("#roleSelect").selectOption("admin");
  await page.getByRole("button", { name: "批量导出客户" }).click();
  await page.getByRole("link", { name: "下载脱敏 CSV" }).waitFor({
    state: "visible",
    timeout: 15000
  });

  const status = await page.locator("#exportState").textContent();
  const notice = await page.locator("#exportNotice").textContent();
  const downloadUrl = await page.locator("#downloadLink").getAttribute("href");

  await page.screenshot({
    path: `${outputDirectory}/demo-admin-export-complete.png`,
    fullPage: true,
    animations: "disabled"
  });

  console.log(
    JSON.stringify(
      {
        status,
        notice,
        downloadUrl,
        screenshots: [
          "demo-final-before-export.png",
          "demo-viewer-denied.png",
          "demo-admin-export-complete.png"
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
