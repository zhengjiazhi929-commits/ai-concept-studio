# AI 视频系统迁移说明

迁移到新电脑时，只需要保存并复制迁移压缩包。压缩包包含系统代码、选题与采集数据、黄金样片、已经生成的视频，以及本地 Git 历史；为了减小体积，不包含可以重新安装的 `node_modules`。

系统代码的云端主仓库是私有仓库：`https://github.com/zhengjiazhi929-commits/ai-concept-studio`。登录对应 GitHub 账号后，可以直接从这里恢复最新版代码与结构化数据。

## 在新电脑上恢复

1. 安装 Codex，并登录自己的账号。
2. 把迁移压缩包解压到一个长期使用的目录，不要放在临时文件夹。
3. 在 Codex 中打开解压后的 `wo` 文件夹。
4. 双击 `studio\启动AI视频系统.cmd`。
5. 第一次启动会联网安装依赖，等待安装完成后，系统会自动打开浏览器页面。

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
pnpm install
pnpm test
```

测试通过后，再双击启动脚本即可。账号登录状态、浏览器 Cookie 和本机 API Key 不会随压缩包迁移，需要在新电脑上重新登录或配置。

## 云端恢复

当 GitHub 与 OneDrive 备份均已配置后，新电脑优先从 GitHub 私有仓库恢复系统代码，再让 OneDrive 同步成片和素材。`studio/config/cloud-backup.local.json` 包含本机 OneDrive 路径，不上传到 GitHub，需要在新电脑上重新配置。页面显示“代码与视频已云端备份”后，才代表两层备份都已成功。
