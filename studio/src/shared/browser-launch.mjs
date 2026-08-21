export function browserLaunchCommand(url, platform = process.platform) {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `start "" "${url}"`]
    };
  }

  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  return { command: "xdg-open", args: [url] };
}
