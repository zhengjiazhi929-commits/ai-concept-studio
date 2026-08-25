# AI Concept Studio

面向 AI 产品经理的 AI 技术概念视频生产系统。目标产品服务 8～12 分钟长视频；当前
`golden-001` M1 是一条 36 秒本地内部技术样片，用来先验证生产与审批闭环，不等于长视频交付。

项目目标不是自动搬运资讯，而是把新出现或正在快速发展的 AI 技术概念，转化为准确、可验证、具有产品决策价值的 8～12 分钟视频。

当前准确状态以 [`docs/STATUS.md`](./docs/STATUS.md) 为唯一来源。当前是受控本地
Agent 原型与整改阶段，不代表 `assisted`、`active` 或正式发布完成。

可运行系统位于 [`studio/`](./studio/)。Windows 双击 [`studio/启动AI视频系统.cmd`](./studio/启动AI视频系统.cmd)，macOS 双击 [`studio/启动AI视频系统.command`](./studio/启动AI视频系统.command)，即可打开本地控制台。代码已经具备从结构化分镜合成本地竖屏 MP4 和执行技术 QA 的能力；当前 `golden-001` 是否已有可验收成片，只能以 Episode 与 [`docs/STATUS.md`](./docs/STATUS.md) 的实时记录为准。

## 本地安装与验证

项目锁定 Node.js `24.19.0` 和 pnpm `11.19.0`。在 `studio/` 目录执行：

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --prod --audit-level high
```

`pnpm verify` 只使用仓库固定输入和临时数据根，覆盖秘密扫描、JS/JSX/TS/TSX、动效库、
全量测试、回滚演练和固定本地渲染；它不调用真实模型、付费 Provider，也不推进任何人工 Gate。

## 当前基准文件

- `docs/01-content-contract.md`：账号定位、受众、内容深度和表达标准
- `docs/02-quality-rubric.md`：选题、脚本和成片的统一质量评分
- `docs/03-topic-selection-rules.md`：黄金样例及日常选题准入规则
- `docs/04-golden-sample-process.md`：第一条黄金样例的人工编排流程
- `docs/05-visual-system.md`：16:9 桌面窗口母版、9:16 重构、安全区、字幕、概念图、转场与可复用组件规范
- `docs/06-agent-architecture-v2.md`：混合式 Main Agent、模型路由、审核协调 Agent、迁移阶段和文件级改造清单
- `docs/07-motion-library.md`：筛选后的横版视频动效组件库、逐项 GIF 和 Remotion 调用方式
- `docs/08-development-governance.md`：仓库采用的 Agent 开发、验证、评测与交付规范
- `docs/STATUS.md`：项目当前状态、验证结果、阻断项和下一准入门槛的唯一真源
- `research/2026-07-30-golden-topic-candidates.md`：已撤回的技术新颖性优先候选，仅保留审计记录
- `research/2026-07-30-creator-heat-audit.md`：热门创作者近期内容与事件信号审计
- `research/2026-07-31-hot-concept-candidates.md`：从热点信号中抽取的纯概念候选，当前正式选题依据
- `research/2026-07-31-agentic-coding-evidence-pack.md`：黄金样例 001 的一手证据底稿
- `episodes/golden-001/`：Agentic Coding 黄金样例；历史上选择过视觉方向 B「真实产品纪录片」，
  但该选择不等于当前 Research / Script / Storyboard Gate 已批准，当前有效门禁只看 `STATUS.md`
- `demo/agentic-coding-saas/`：用于黄金样例的本地可复现 SaaS 任务；全部为虚构数据，用于真实记录红测、修复、Diff 与浏览器验收

## 核心流程

```text
趋势发现
→ 选题规划
→ 研究与证据核验
→ 人工研究审批
→ 大纲与脚本
→ 人工脚本审批
→ 分镜
→ 人工分镜审批
→ 素材与旁白
→ 人工素材审批
→ 视频合成与 QA
→ 人工成片审批
→ 发布复盘
```

## 当前原则

1. 竞品内容只作为市场信号，不作为事实来源。
2. 关键技术主张必须回链到官方公告、文档、论文、模型卡或官方仓库。
3. Agent 负责提效，人负责选题及研究、脚本、分镜、素材、成片五道审批；系统不自动发布。
4. 黄金样例作为所有新 Agent 和视频模板改动的回归标准；一次只增加一个可验证模块。
5. 第一版不自动发布，也不未经授权批量抓取平台创作者内容。

## 黄金样例当前进度

- 旧 `trusted-fixture` 审批已失效；Research v1 与 Script v1 已由 Zhengjiazhi 按当前版本、
  内容哈希和机器报告重新批准，当前停在 Storyboard v1 人工 Gate；
- 长版 `07-script.md` / `08-storyboard.md` 只作参考，不能代表当前 36 秒六段短脚本和六镜结构；
- 四张虚构数据的真实产品截图已经登记并带 bytes / SHA-256；
- 本地控制台、Workflow Kernel、五道 Gate、机器审核、中断恢复和版本化渲染代码已经存在；
- 本轮只允许用本地离线旁白和固定输入完成 M1，不调用付费媒体 API；Storyboard 批准前，
  不生成可供素材/声音 Gate 使用的新旁白；
- 之前生成的 `v001` 旁白与 dossier 早于当前强绑定检查，已作废，只保留为历史文件，
  不能用于审批、渲染或发布；当前没有有效旁白候选和当前成片；
- 历史提交和其他工作树曾生成的视觉验证视频只作为历史证据，不能冒充当前 Episode 成片；
- 未经素材/声音 Gate 批准，不得渲染；未经当前 MP4 的 QA 和最终 Gate，不得声明业务验收或发布完成。

本地 M1 的产品要求、范围和执行顺序分别见 [`docs/PRD.md`](./docs/PRD.md)、
[`docs/scope.md`](./docs/scope.md) 和 [`docs/m1-roadmap.md`](./docs/m1-roadmap.md)。

## 可选备份

仓库提供 Git 与 OneDrive 分层备份能力，但“提供能力”不等于已经配置或成功备份。是否已
连接 OneDrive、最近一次成功时间和覆盖范围，必须以控制台或 `docs/STATUS.md` 的实时证据为准；
当前 M1 不依赖 OneDrive。整改分支未 push 前，也不能说代码已经进入 GitHub。

需要启用时，根据系统选择 `studio/config/cloud-backup.example.json`（Windows）或
`studio/config/cloud-backup.macos.example.json`（macOS），复制为不会进入 Git 的
`studio/config/cloud-backup.local.json`，配置 `mediaRoot` 后先运行 `pnpm cloud:status`，
再由操作员明确执行 `pnpm cloud:backup`。API Key、Cookie、依赖和临时文件不得上传。
