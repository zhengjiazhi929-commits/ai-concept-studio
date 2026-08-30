#!/bin/zsh
set -eu

studio_directory="${0:A:h}"
cd "$studio_directory"

runtime_root="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
bundled_node="$runtime_root/node/bin/node"
bundled_pnpm="$runtime_root/bin/fallback/pnpm"

fail_startup() {
  print -u2 -- "$1"
  read -k 1 "?按任意键关闭窗口……" || true
  print
  exit 1
}

if [[ -x "$bundled_node" && -x "$bundled_pnpm" ]]; then
  export PATH="$runtime_root/node/bin:$PATH"
  studio_pnpm="$bundled_pnpm"
else
  command -v node >/dev/null 2>&1 || fail_startup "没有找到项目锁定的 Node.js 24.19.0。请先安装并重试。"
  command -v pnpm >/dev/null 2>&1 || fail_startup "没有找到 pnpm。请先安装并重试。"
  studio_pnpm="$(command -v pnpm)"
fi

expected_node_version="$(<../.node-version)"
actual_node_version="$(node -p 'process.versions.node')"
[[ "$actual_node_version" == "$expected_node_version" ]] || fail_startup \
  "Node.js 版本不匹配：需要 ${expected_node_version}，当前为 ${actual_node_version}。"

expected_pnpm_version="$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).engines.pnpm')"
actual_pnpm_version="$("$studio_pnpm" --version)"
[[ "$actual_pnpm_version" == "$expected_pnpm_version" ]] || fail_startup \
  "pnpm 版本不匹配：需要 ${expected_pnpm_version}，当前为 ${actual_pnpm_version}。"

if [[ ! -d node_modules ]]; then
  print -- "首次启动：正在按锁文件安装本地依赖，请稍候……"
  "$studio_pnpm" install --frozen-lockfile || fail_startup "安装失败，请检查网络后重试，或回到 Codex 里让我检查。"
fi

"$studio_pnpm" start:open || fail_startup "系统未能正常启动，请回到 Codex 里让我检查。"
