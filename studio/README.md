# AI Concept Studio

面向 AI 产品经理的长视频 Agent 制作系统。目标是把近期正在形成共识的 AI 技术概念，转化为有证据、可审批、能持续维护的 8～12 分钟竖屏视频。

当前版本不是自动发布工具。它会完成发现、整理、生成、渲染和检查，但选题仍由人决定，并固定保留研究、脚本、分镜、素材、最终成片五个人工审批闸门。

## 当前进度

- 热点概念发现 Agent v0.1 已可运行：读取创作者信号、归一化概念、去除事件噪声、按独立创作者共振打分，并把候选送入人工选择。
- 创作者信号采集 Agent v0.1 已可运行：B站公开页程序直读，抖音等客户端渲染页面生成 Codex 辅助任务，统一去重后再刷新热点雷达。
- Research Agent v0.1 已可运行：人工选题会创建一期草稿，系统检查一手资料可达性、建立 8 类事实问题、生成 Codex 辅助任务，并在证据达到硬门槛前阻止研究审批。
- 已配置 18 个观察源，首份公开信号快照包含 51 条内容信号；缺失播放量和评论数据时不会猜测。
- Agentic Coding 黄金样例已贯通结构化数据、真实产品画面、Remotion 竖屏 MP4 和自动 QA。
- 脚本、分镜和素材清单 Agent 已接入 Responses API 结构化生成：AiHubMix 默认为主通道，OpenAI 官方为备用通道，也可在控制台即时互换；每版产物、人工决定和驳回意见都会保留。
- 素材 Agent 只登记真实截图、录屏、概念图和授权素材，真实产品界面不得由生成式 UI 冒充；旁白和素材在同一道闸门总审。
- 内容 QA 已覆盖事实来源、场景结构、证据素材、字幕连续性/阅读速度与旁白对齐，不再只检查视频编码。
- 进程中断会在下次启动时恢复为可重试状态；渲染输出自动递增版本，不覆盖上一版成片。
- 周期调度尚未接入；当前可以在控制台手动运行采集，也可以由后续 Codex 自动任务触发。

```mermaid
flowchart LR
  A[公开创作者页面] --> B[信号采集 Agent]
  B --> C[热点概念发现 Agent]
  C --> D{人工选题}
  D --> E[一手资料研究]
  E --> F{研究审批}
  F --> G[脚本生成]
  G --> H{脚本审批}
  H --> I[分镜生成]
  I --> J{分镜审批}
  J --> K[素材与旁白]
  K --> L{素材审批}
  L --> M[视频渲染与 QA]
  M --> N{成片审批}
```

## 打开系统

- Windows：双击 `启动AI视频系统.cmd`；
- macOS：双击 `启动AI视频系统.command`。如果系统阻止首次打开，请右键该文件并选择“打开”；也可以在终端运行 `./启动AI视频系统.command`；
- Linux：在本目录运行 `pnpm start:open`。

启动后，本地控制台会打开：

`http://127.0.0.1:4317`

在“热点概念雷达”里可以重新运行发现 Agent，并把通过门槛的概念选为研究候选。关闭启动窗口即可停止服务，项目数据与视频不会丢失。

## 常用操作

在本目录中运行：

```text
pnpm import:trends   导入默认公开信号快照
pnpm collect         检查公开来源并刷新可直读信号
pnpm import:collector -- <文件名>  导入 Codex 辅助采集批次
pnpm trends          重新计算热点候选
pnpm research        为已选概念建立一手资料与事实证据任务
pnpm import:research -- <文件名>  导入 Codex 辅助研究证据批次
pnpm test            运行回归测试
pnpm check           检查主要模块语法
pnpm render:preview  重新生成黄金样例视频
pnpm qa              检查黄金样例视频
```

## AI 通道与本地密钥

模型与限额写在 `config/ai.json`，密钥只放在不会进入 Git 的 `.env.local`：

```text
AIHUBMIX_API_KEY=你的 AiHubMix Key
OPENAI_API_KEY=可选的 OpenAI API Key
```

可复制 `.env.example` 为 `.env.local` 后填写。控制台只显示通道“已配置/未配置”，不会返回或打印密钥。默认模型可用 `AIHUBMIX_MODEL` 或 `OPENAI_MODEL` 在本机覆盖，密钥和本机模型选择都不会进入 Git。

一次生成遇到可重试故障时，当前主通道最多执行 3 次（首次加两次重试），然后只调用备用通道 1 次。明确的无额度、无权限、密钥或模型错误不会在同一通道重复消耗请求，而是直接进入备用通道。仍失败就把完整尝试记录写入一期状态并暂停，不会继续烧额度。每期默认最多发起 12 个生成任务。

任一人工闸门被驳回后，系统保存旧版本和修改意见，只把当前阶段及其下游重置为待处理；生成新版本后审批重新变为待确认。替换素材或旁白也会自动作废下游渲染和成片审批。

macOS 如果启用了 Clash 等系统代理，服务会自动读取 HTTPS 系统代理；Windows/Linux 优先读取标准的 `HTTPS_PROXY` 或 `HTTP_PROXY` 环境变量。

OpenAI API 与 ChatGPT 订阅分开计费。若出现“no credits remaining”，需要在 [OpenAI API Billing](https://platform.openai.com/settings/organization/billing) 添加 API 额度；这不是密钥失效或普通限流。

## 关键文件

- `TREND-AGENT.md`：热点发现 Agent 的数据、门槛、评分和更新方法。
- `COLLECTOR-AGENT.md`：公开来源采集、Codex 辅助和失败恢复方法。
- `RESEARCH-AGENT.md`：一手资料、主张台账、证据门槛和研究审批方法。
- `SYSTEM-CONTRACT.md`：系统边界、人工闸门和完成标准。
- `../docs/06-agent-architecture-v2.md`：Main Agent、Model Router、审核协调层、迁移顺序和文件级实施任务。
- `config/trend-sources.json`：创作者观察源及权重。
- `config/concept-taxonomy.json`：概念、别名、产品决策与一手资料计划。
- `config/trend-radar.json`：时间窗口、硬门槛和评分权重。
- `config/collector.json`：采集超时、并发、有效窗口与适配器配置。
- `config/ai.json`：主/备用模型通道、任务模型、超时、重试和单期调用上限；不含密钥。
- `data/collector/assist-task.json`：普通程序无法读取时交给 Codex 的采集任务。
- `data/trends/signals.json`：已经导入的标准化市场信号。
- `data/trends/latest.json`：最近一次热点发现结果。
- `data/trends/selection.json`：人工选择后交给研究 Agent 的任务。
- `data/research/`：研究计划、运行快照、辅助任务和证据批次。
- `data/episodes/<期数>/episode.json`：每期视频唯一状态源。
- `src/server/agents/registry.mjs`：一期制作 Agent 的统一入口。
- `src/server/production/`：结构化脚本/分镜生成、版本化产物和内容质量门槛。
- `src/video/`：可维护的视频模板。

## 维护原则

1. 竞品内容只证明“市场在讨论”，不能证明技术事实；事实必须回到官方文档、论文或原始项目。
2. 同一创作者的多个账号或同一系列内容只计一个独立覆盖组。
3. 产品发布、融资和大会内容先提炼成可跨产品解释的概念，事件本身不直接立项。
4. 缺失数据保持缺失，界面显示已知维度和置信度，不填造播放量、互动率或评论问题密度。
5. 选题必须经过人工确认；系统不自动发布，也不把 Cookie、账号或密钥写入项目。
6. 每新增一个模块，先用固定样例和回归测试验证可复现，再接入生产流程。
