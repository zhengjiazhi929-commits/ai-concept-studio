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
  command -v node >/dev/null 2>&1 || fail_startup "没有找到 Node.js 20 或更高版本。请先安装并重试。"
  command -v pnpm >/dev/null 2>&1 || fail_startup "没有找到 pnpm。请先安装并重试。"
  studio_pnpm="$(command -v pnpm)"
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( node_major >= 20 )) || fail_startup "Node.js 版本过低，需要 20 或更高版本。"

if [[ ! -d node_modules ]]; then
  print -- "首次启动：正在按锁文件安装本地依赖，请稍候……"
  "$studio_pnpm" install --frozen-lockfile || fail_startup "安装失败，请检查网络后重试，或回到 Codex 里让我检查。"
fi

"$studio_pnpm" start:open || fail_startup "系统未能正常启动，请回到 Codex 里让我检查。"
