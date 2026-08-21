# AI 视频系统迁移说明

系统代码的云端真源是 GitHub 仓库：`https://github.com/zhengjiazhi929-commits/ai-concept-studio`。应优先从这里恢复最新版代码、配置、文档和可复用的小型素材。

GitHub 不保存 `node_modules`、生成视频和大素材。依赖会在首次启动时按锁文件重新安装；视频和素材需要从 OneDrive 恢复。早期迁移压缩包只作为历史快照，不应覆盖 GitHub 中较新的代码。

## 在新电脑上恢复

1. 安装 Codex，并登录自己的账号。
2. 从 GitHub 仓库下载或克隆最新版到长期使用的目录，不要放在临时文件夹。
3. 在 Codex 中打开项目根目录。
4. Windows 双击 `studio\启动AI视频系统.cmd`；macOS 双击 `studio/启动AI视频系统.command`。
5. 第一次启动会联网按 `pnpm-lock.yaml` 安装依赖，完成后自动打开浏览器页面。
6. 复制 `studio/.env.example` 为 `studio/.env.local`，重新配置本机 OpenAI/AiHubMix 密钥；真实密钥不会随 GitHub 迁移。

macOS 如果提示无法打开 `.command` 文件，请右键选择“打开”。如果文件没有执行权限，在项目根目录运行：

```bash
chmod +x ./studio/启动AI视频系统.command
./studio/启动AI视频系统.command
```

如果双击启动失败，请在 Codex 中打开这个项目并说：“请按照 `MIGRATION.md` 帮我恢复并启动系统”。

## 重要内容的位置

- 系统代码与界面：`studio`
- 趋势和采集数据：`studio\data`
- 已生成视频和预览：`outputs`
- 黄金样例演示项目的原始 Git 历史备份：`backups\agentic-coding-saas-history.bundle`
- 项目说明：`README.md`、`studio\README.md`、`studio\SYSTEM-CONTRACT.md`

## 恢复后检查

在 `studio` 目录安装依赖并运行测试：

```text
pnpm install --frozen-lockfile
pnpm test
```

测试通过后，再使用当前系统对应的启动脚本。账号登录状态、浏览器 Cookie 和本机 API Key 不会随仓库迁移，需要在新电脑上重新登录或配置。

## 云端恢复

当 GitHub 与 OneDrive 备份均已配置后，新电脑优先从 GitHub 仓库恢复系统代码，再让 OneDrive 同步成片、音频、运行数据和素材。`studio/config/cloud-backup.local.json` 包含本机 OneDrive 路径，不上传到 GitHub，需要在新电脑上重新配置。

- Windows 示例：`studio/config/cloud-backup.example.json`；
- macOS 示例：`studio/config/cloud-backup.macos.example.json`。OneDrive 目录通常位于 `~/Library/CloudStorage/OneDrive-*`，但必须以 Finder 中的真实同步目录为准。

页面显示“代码与视频已云端备份”后，才代表两层备份都已成功。
