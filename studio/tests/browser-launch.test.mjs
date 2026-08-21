import test from "node:test";
import assert from "node:assert/strict";
import { browserLaunchCommand } from "../src/shared/browser-launch.mjs";

const url = "http://127.0.0.1:4317";

test("Windows 使用 cmd start 打开本地控制台", () => {
  assert.deepEqual(browserLaunchCommand(url, "win32"), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `start "" "${url}"`]
  });
});

test("macOS 使用 open 打开本地控制台", () => {
  assert.deepEqual(browserLaunchCommand(url, "darwin"), {
    command: "open",
    args: [url]
  });
});

test("Linux 使用 xdg-open 打开本地控制台", () => {
  assert.deepEqual(browserLaunchCommand(url, "linux"), {
    command: "xdg-open",
    args: [url]
  });
});
