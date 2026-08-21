import { spawn } from "node:child_process";
import { once } from "node:events";
import { createStudioServer } from "../src/server/app.mjs";
import { browserLaunchCommand } from "../src/shared/browser-launch.mjs";

const { server, config } = await createStudioServer();

server.listen(config.port, config.host);
try {
  await once(server, "listening");
} catch (error) {
  console.error(`启动失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
  throw error;
}

const url = `http://${config.host}:${config.port}`;
console.log(`AI Concept Studio 已启动：${url}`);
console.log("关闭这个窗口即可停止系统，本地数据和已生成视频不会丢失。");

const launch = browserLaunchCommand(url);
const browser = spawn(launch.command, launch.args, {
  detached: true,
  windowsHide: true,
  stdio: "ignore"
});
browser.once("error", () => {
  console.warn(`无法自动打开浏览器，请手动访问：${url}`);
});
browser.unref();

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
