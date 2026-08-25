# 现有原型审计

审计日期：2026-08-25
审计基线：`71e3daeca70ee74a333f0153dd01f1b785be915a`
整改分支：`codex/agent-v2-remediation-20260824`

## 审计结论

仓库不是 SOP 示例中的 Python 原型，而是一套 Node.js + Remotion 的本地应用。它已经具备
Episode 状态、五道人审、Agent 编排、结构化生成适配器、素材登记、视频渲染和技术 QA；
但审计基线上的 `golden-001` 只有研究、脚本、分镜和四张真实产品截图，旁白未配置，
`outputs/studio/` 为空，因此不能把历史说明中的“曾经生成过视频”当作当前 M1 成片证据。

## 真实入口与复现方式

| 用途 | 入口 | 输入 | 输出 / 状态 |
|---|---|---|---|
| 本地控制台 | `cd studio && pnpm start` | `studio/config/*.json`、Episode | `127.0.0.1:4317` |
| 黄金样例导入 | `pnpm import:golden` | `episodes/golden-001/` | `studio/data/episodes/golden-001/episode.json` |
| Agent 执行 | 控制台或 `src/server/orchestrator.mjs` | 当前 Episode、Kernel 合法动作、Capability | 新版本产物和 Episode 状态 |
| Remotion 渲染 | `pnpm render:preview` | 已通过素材/声音 Gate 的 Episode | `outputs/studio/<episode>/preview-vNNN.mp4` |
| 视频 QA | `pnpm qa` | 当前登记成片 | `preview-qa-vNNN*.json` 与 Episode QA |
| 工程验证 | `pnpm check && pnpm test` | tracked fixtures / 临时数据根 | 语法和回归测试结果 |

真实运行前还必须使用仓库固定的 Node / pnpm 版本和 frozen lockfile；workflow 与版本文件
负责把这一条件机械化。当前只证明本地等价命令通过，分支未 push、hosted GitHub Actions
尚未运行。运行真实 Episode 不能代替测试，测试也不能写入真实 Episode。

## 依赖与外部能力

- 直接运行时依赖：React、Remotion bundler/renderer、Undici、Phosphor Icons。
- 系统依赖：Node.js、pnpm、Chromium 系浏览器；部分历史辅助脚本依赖 macOS 的
  `say`、`afconvert`、`sips` 或 `qlmanage`。
- 可选外部 Provider：OpenAI、AiHubMix；默认配置只描述 Provider，密钥只能来自未跟踪的
  本地环境。未经当前任务明确授权和 Capability，不得调用。
- 可选公开数据源：Bilibili 公开页、人工导入的 Douyin 信号、官方文档/论文/仓库。
- 可选备份：用户本机 OneDrive 目录；不属于 M1 必需路径。
- 本地离线 TTS：固定 Kokoro 模型、配置与音色文件；模型文件位于用户缓存，不进入 Git，
  生成进程必须在导入推理栈前校验固定 Python/依赖，并拒绝 Python socket API。该应用层
  保护不等于阻断操作系统全部 DNS/TCP/UDP，也不提供全机流量证明。

## 输入、输出和异常行为

1. `episode.json` 是单期状态真源；Markdown、UI、日志和文件存在性不能覆盖它。
2. 生成型 Worker 输出新版本草稿；人工批准只绑定当前版本、内容哈希和机器审核报告。
3. 素材、旁白和成片写入前必须持有服务端签发的窄 Capability，并通过路径、大小、格式、
   内容哈希和 CAS 检查。
4. Provider 请求发出后如果结算或本地提交状态不明，预算和任务必须冻结，不能自动重试。
5. 渲染失败保留旧版本并删除 `.rendering` 临时文件；成片缺失或哈希漂移会让 QA 与终审失效。

## 配置、秘密与个人路径

- `.env`、`.env.*`、`studio/config/ai.local.json`、本地备份配置和运行数据均被忽略。
- `OPENAI_API_KEY`、`AIHUBMIX_API_KEY` 只能从环境读取；日志和错误响应必须字段级脱敏。
- 少量历史视觉证明脚本仍写死 `/Applications/Google Chrome.app/...`；它们是平台特定的
  辅助脚本，不是 M1 主路径。主 renderer 会按平台查找浏览器。
- 示例 OneDrive 路径只含占位用户名；真实个人绝对路径不得进入配置样例、测试或证据。

## 成功样例证据边界

- 可复现的代码级基线：tracked fixture、全量测试和隔离数据根测试。
- `golden-001` 的固定合法输入和四张虚构数据产品截图可复现。
- 当前没有有效 MP4、旁白或 QA 报告；历史 v001 旁白早于强绑定校验，不能复用。长版
  `07-script.md` / `08-storyboard.md` 仅是参考来源，历史三道上游 `trusted-fixture` 状态也
  不是当前人审证据。M1 只有在重新批准研究、当前 36 秒短脚本和六镜分镜、本地生成新旁白、通过素材/声音 Gate、
  重新渲染、完成媒体与画面 QA、再通过最终 Gate 后才成立。
- 历史分支或其他 worktree 的 MP4 不自动成为当前 Episode 的成片证据。

## 基线与回退

- 原型主线基线：本地 `main` 的 `c1cd165`。
- 本次整改起点：`b29ebe9`，前三批整改提交为 `cec7b54`、`f08a786`、`71e3dae`。
- 回退以提交为单位；Episode / 媒体使用版本化文件和备份恢复，禁止覆盖人工批准版本。
- 当前没有发布标签。创建公开版本标签必须等到 M1、clean install、许可证和最终人审通过。

详细文件处置见 [file-classification.md](file-classification.md)，架构见
[current-architecture.md](current-architecture.md)，差距见 [gap-analysis.md](gap-analysis.md)。
