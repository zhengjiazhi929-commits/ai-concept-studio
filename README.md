# AI Concept Studio

面向 AI 产品经理的 AI 技术概念长视频生产系统。

项目目标不是自动搬运资讯，而是把新出现或正在快速发展的 AI 技术概念，转化为准确、可验证、具有产品决策价值的 8～12 分钟视频。

当前阶段：`Phase 1 — 本地 Agent 制作系统 v0.1`

可运行系统位于 [`studio/`](./studio/)。双击 [`studio/启动AI视频系统.cmd`](./studio/启动AI视频系统.cmd) 可打开本地控制台；当前已经能从结构化分镜和真实产品截图生成竖屏 MP4，并执行自动技术 QA。

## 当前基准文件

- `docs/01-content-contract.md`：账号定位、受众、内容深度和表达标准
- `docs/02-quality-rubric.md`：选题、脚本和成片的统一质量评分
- `docs/03-topic-selection-rules.md`：黄金样例及日常选题准入规则
- `docs/04-golden-sample-process.md`：第一条黄金样例的人工编排流程
- `docs/05-visual-system.md`：竖屏长视频的画布、字体、颜色、字幕与可复用组件规范
- `research/2026-07-30-golden-topic-candidates.md`：已撤回的技术新颖性优先候选，仅保留审计记录
- `research/2026-07-30-creator-heat-audit.md`：热门创作者近期内容与事件信号审计
- `research/2026-07-31-hot-concept-candidates.md`：从热点信号中抽取的纯概念候选，当前正式选题依据
- `research/2026-07-31-agentic-coding-evidence-pack.md`：黄金样例 001 的一手证据底稿
- `episodes/golden-001/`：Agentic Coding 黄金样例；视觉方向 B「真实产品纪录片」已确认，分镜和生产清单已切换到 v0.2
- `demo/agentic-coding-saas/`：用于黄金样例的本地可复现 SaaS 任务；全部为虚构数据，用于真实记录红测、修复、Diff 与浏览器验收

## 核心流程

```text
趋势发现
→ 选题规划
→ 人工审批
→ 研究与证据核验
→ 技术机制与产品影响分析
→ 大纲与脚本
→ 分镜与素材
→ 视频合成
→ 人工验收
→ 发布复盘
```

## 当前原则

1. 竞品内容只作为市场信号，不作为事实来源。
2. 关键技术主张必须回链到官方公告、文档、论文、模型卡或官方仓库。
3. Agent 负责提效，人负责选题、判断、定稿和发布。
4. 黄金样例作为所有新 Agent 和视频模板改动的回归标准；一次只增加一个可验证模块。
5. 第一版不自动发布，也不未经授权批量抓取平台创作者内容。

## 黄金样例当前进度

- 脚本已经人工通过；
- 视觉方向 B 已经人工通过；
- 本地演示项目 baseline 已固定为 Git 提交 `d3ef196`；
- baseline `d3ef196` 的验收测试为 5 项中 1 项通过、4 项失败，这是 Agent 开始工作前的真实状态；
- Coding Agent 第一版实现 `c619b0c` 已达到 5/5 通过，HTTP 验收也已通过；
- final `e717f5f` 已保存运行记录、限制和可复现证据；
- Before 失败、普通用户被拒绝、管理员完成导出等 5 张真实浏览器截图已采集；
- 36 秒无旁白视觉验证版已由渲染 Agent 真实生成，H.264、尺寸、帧率、时长、像素格式和文件完整性 QA 全部通过；
- 本地控制台、8 个 Agent 接口、人工闸门、状态恢复和回归测试已落地；
- 热点采集、热点发现和 Research Agent v0.1 已接入；下一步是在控制台选择正式候选、完成首个非黄金样例证据包，并把脚本 Agent 升级为基于证据生成。

## 云端备份

系统采用分层备份：代码、配置和小型结构化数据进入 GitHub 私有仓库；成片和素材复制到 OneDrive；API Key、Cookie、依赖和临时文件不上传。控制台顶部会显示当前保护状态。

OneDrive 登录后，将 `studio/config/cloud-backup.example.json` 复制为不会进入 Git 的 `studio/config/cloud-backup.local.json`，并把 `mediaRoot` 改为 OneDrive 内的素材目录。随后在 `studio` 目录运行 `npm run cloud:backup` 完成首次全量复制。之后每次渲染完成，系统会自动复制新成片；也可以随时运行 `npm run cloud:status` 检查状态。
