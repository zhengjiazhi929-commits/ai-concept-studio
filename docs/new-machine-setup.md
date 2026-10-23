# 在新电脑继续开发

本文用于恢复代码开发环境，不是生产数据迁移或视频验收说明。当前未合并工作位于
`codex/video-discovery-20261022`；只克隆 `main` 不会取得本轮新增能力。

## 1. 获取工作分支

```sh
git clone --branch codex/video-discovery-20261022 https://github.com/zhengjiazhi929-commits/ai-concept-studio.git
cd ai-concept-studio
git status --short --branch
git log -1 --oneline
```

先读取 `AGENTS.md`、`docs/08-development-governance.md` 和 `docs/STATUS.md`。
这是独立 clone，不要复制旧电脑的 `.git` worktree 指针、`node_modules`、缓存或绝对路径。
未来若分支已合并，以 GitHub 和 STATUS 的实际状态为准；不要重放历史提交或生产脚本。

## 2. 准备锁定运行环境

- Node.js：按根目录 `.node-version`，当前 `24.19.0`。
- pnpm：按 `studio/package.json`，当前 `11.19.0`。
- Python QA：按 `studio/scripts/qa-agent-skill-long-review-wide-v004-python-runtime.json`，当前 CPython `3.12.13`。
- Node、Python 必须匹配本机系统和芯片。不要复制旧机器的可执行程序或 Python venv。

安装上述运行时后，进入 `studio/`，用 `node --version`、`pnpm --version` 和 Python 的
`--version` 核对精确版本，再执行：

```sh
pnpm install --frozen-lockfile
```

若尚无 pnpm，可在已安装指定 Node 的环境运行 `npm install --global pnpm@11.19.0`。
不要为了安装成功改动锁文件或升级 Remotion。请先安装标准路径下的 Chrome/Chromium（Windows 也支持 Edge），
并补齐系统运行库；固定渲染检查只使用已安装的浏览器，不自动下载浏览器。

macOS / Linux 的 Python QA 环境示例（从 `studio/` 执行）：

```sh
python3.12 -c 'import sys; assert sys.version_info[:3] == (3, 12, 13), sys.version'
python3.12 -m venv --copies tmp/qa-venv
tmp/qa-venv/bin/python -m pip install --disable-pip-version-check --require-hashes -r scripts/qa-agent-skill-long-review-wide-v004-requirements.lock.txt
export QA_PYTHON="$PWD/tmp/qa-venv/bin/python"
```

Windows PowerShell 对应示例：

```powershell
py -3.12 -c "import sys; assert sys.version_info[:3] == (3, 12, 13), sys.version"
py -3.12 -m venv --copies tmp/qa-venv
.\tmp\qa-venv\Scripts\python.exe -m pip install --disable-pip-version-check --require-hashes -r scripts/qa-agent-skill-long-review-wide-v004-requirements.lock.txt
$env:QA_PYTHON = (Resolve-Path .\tmp\qa-venv\Scripts\python.exe).Path
```

这里使用 `--copies`，避免 QA 对解释器取真实路径后离开软链接 venv、找不到锁定的 Python 包。

## 3. 先验证，再开始新任务

```sh
pnpm verify
pnpm audit --prod --audit-level high
```

检查使用合成 Fixture/临时数据，不需要旧视频、API 密钥、付费 Provider 或人工批准。
真实 API 凭据和本地操作者身份必须在新电脑按需重新配置，不能提交到仓库。
验证失败应保留错误，不以跳测试、扩大授权或拷贝旧运行数据掩盖问题。
本地通过、GitHub CI 通过、合并 main 和实际视频验收是不同结论。

## 4. 本轮提交能带走什么

- 可复用的发现配置、零付费研究入口、脚本/分镜确定性审核入口。
- 可执行分镜的插画、空间包含、正交线、材料传送、章节导航及回归测试。
- 安全边界、开发治理和本接续文档。

**不会随 clone 带走**：`outputs/`、手工 Episode、研究/生产状态、审计账本、
历史视频、临时 `HANDOFF.md`、本地凭据。此次用户决定先不制作 Harness 新片，
这些本地资料保留但不上传、不删除；新机可继续开发系统或创建新一期，不能声称已恢复旧片状态。

若以后要恢复该片，需另行制作排除凭据的定向数据包，保留相对路径和文件 SHA-256，
并核对源文件、版本、人工审批与审核绑定。现有 `cloud:backup` 只覆盖视频与公开素材，
不是完整项目迁移工具；不要从 Markdown 或旧一次性 runner 重建/重放生产历史。
