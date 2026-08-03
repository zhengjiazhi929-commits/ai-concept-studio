# 热门 AI 创作者选题审计

> **说明：本文件用于记录创作者热点信号。文件中的事件型候选不再直接作为成片题目。**  
> 2026-07-31 起，正式选题以 `2026-07-31-hot-concept-candidates.md` 为准。

更新时间：2026-07-30  
观察窗口：重点看近 7～30 天，必要时回看 60 天确认是否为持续话题  
目标：验证哪些 AI 概念已经形成主流创作者讨论势能，而不是寻找“几乎没人讲的新论文”

## 结论

上一轮五个候选不应直接进入生产：

- Stateless MCP
- Diffusion Language Model
- Harness Engineering
- AgentWorld
- 多目标 Model Routing

它们有技术价值，但当前没有完成“多个热门 AI 创作者近期重复覆盖”的验证，现已全部退回技术观察池。

本轮公开页面初筛与跨平台复核显示，当前更主流的内容集群是：

1. **Kimi K3、MoE、开放权重与大模型选型**
2. **Agentic Coding / Vibe Coding / Codex / Claude Code**
3. **GPT-5.6 与“按任务成本选模型”**
4. **GPT-Live 与全双工语音交互**
5. **WAIC 带动的 Physical AI、世界模型与 VLA**
6. **Agent 工程栈与安全：Skill、MCP、Memory、权限、沙箱**

## 已核对的重点创作者样本

以下为公开页面可见信息初筛。账号粉丝和视频绝对数据仅作背景，不跨账号直接比较。

| 平台 | 创作者 | 近期可见主题 | 本轮作用 |
|---|---|---|---|
| 抖音 | [AI大模型学习（用户参考账号）](https://www.douyin.com/user/MS4wLjABAAAALc4kETj5YEPPpJXumFbEKsrihV9MQCdEtP4p8im0w2g) | Agent 记忆、Agent 架构、主流 AI 名词、Vibe Coding、MCP vs CLI、Loop Engineering、Function Calling、Skill、幻觉 | 确认账号风格和目标内容形态 |
| 抖音 | [我叫秋水](https://jingxuan.douyin.com/m/video/7610025599746264339) | CLI/MCP/Skill 选型、Skill vs Sub-agent、MCP vs Skills、AI 第二大脑、多智能体、Agent 基础术语 | 很强的近期 Agent 工程栈信号 |
| 抖音 | [Ai大模型学习](https://jingxuan.douyin.com/m/video/7649325778957585727) | RAG 方案选型、内容生成 Skill、Agent Skill、Codex 能力与办公自动化 | 验证 Skill、RAG、Codex 的持续覆盖 |
| 抖音 | [大模型项目实战](https://jingxuan.douyin.com/m/video/7659339584513379630) | Agent 记忆污染、海量 Skill 加载、长任务上下文溢出、RAG 热更新与分块 | 验证生产级 Agent 问题 |
| 抖音 | [Sherry小水](https://jingxuan.douyin.com/m/video/7629765089143670080) | Codex、Skill、插件、Computer Use、AI 自动化、AI 热点工作流 | 验证 AI Coding Agent 与扩展生态 |
| 抖音 | [Ning好](https://jingxuan.douyin.com/m/video/7646442018788478208) | 高频 Vibe Coding 应用、新闻情报智能体、AI 自动成片、模型成本 | 验证 Vibe Coding 的持续热度 |
| 抖音 | [AI风向标](https://jingxuan.douyin.com/m/video/7655645706144779572) | GLM-5.2、Claude Tag、Claude Science、开放知识格式、Seedance、物理 AI | 验证近期发布与大众话题 |
| 抖音 | [C哥聊科技](https://jingxuan.douyin.com/m/video/7660793870694763791) | GPT-5.6、ChatGPT 与 Codex 合并、Agent 入口 | 验证 GPT-5.6 的产品叙事 |
| 抖音 | [拿幸·AI启示录](https://jingxuan.douyin.com/m/video/7660745998112722222) | GPT-5.6 三档模型、Codex 并入工作模式、多 Agent | 验证长视频解释空间 |
| B站 | [kate人不错：GPT-5.6 16 项实测](https://www.bilibili.com/video/BV1HBNL6cE64/) | GPT-5.6、ChatGPT Work、Codex、PPT/Excel/网页/代码实测 | 截至检索时页面显示约 5.2 万播放，验证实测需求 |
| B站 | [尚硅谷：Vibe Coding 系统课程](https://www.bilibili.com/video/BV1RPET6tEp2/) | Claude Code、Codex、Skills、MCP、记忆、完整项目 | 截至检索时页面显示约 86.5 万播放，验证大盘热度 |
| B站 | [费曼学AI：Agent 记忆系统](https://www.bilibili.com/video/BV1uiEM6xE9s/) | Agent Memory、上下文、Agent Loop、Harness、RAG | 验证 Agent 记忆的长视频需求 |
| B站 | [AI前沿访谈：Agent 记忆工程](https://www.bilibili.com/video/BV1MBTV6gEso/) | 长短期记忆、持久化架构、LangGraph | 验证跨账号、跨平台覆盖 |
| B站 | [五里墩茶社：GPT-5.6 三档模型与并行 Agent](https://www.bilibili.com/video/BV1q4N56UEVa/) | GPT-5.6 分层、ultra、多智能体 | 验证模型分层与并行 Agent 角度 |

### 补充的近期抖音样本

为避免只观察教程类账号，本轮又加入近期高频更新的 AI 资讯、产品与长视频账号：

- [拿幸·AI启示录](https://jingxuan.douyin.com/m/video/7664895927072591119)：Claude、Agent 安全、AI 数学、WAIC；
- [人民公园说AI](https://jingxuan.douyin.com/m/video/7660912883055856915)：GPT-5.6、国产模型、AI 超级 App；
- [杜雨说AI](https://jingxuan.douyin.com/m/video/7665614335116332330)：Kimi K3、Codex、Manus、WAIC；
- [大模型老迈](https://jingxuan.douyin.com/m/video/7665665833837940003)：Agent 学习、核心概念和一人公司；
- [鸣姐.AI进阶](https://jingxuan.douyin.com/m/video/7620785929350925631)：AI 产品开发、Vibe Coding、智能体信息搜索；
- [HowOneAI-余一](https://jingxuan.douyin.com/m/video/7636811401314572666)：GPT-5.6、真实任务 Benchmark、AI 产品决策。

这 6 个账号的近期内容共同支持以下判断：

- Agent / AI Coding / 工作流：6 个账号出现相关内容；
- 新模型的真实使用、成本与国产模型比较：至少 5 个账号；
- WAIC 带动的 Physical AI / 世界模型 / 具身智能：至少 4 个账号；
- Agent 安全、权限与沙箱：至少 3 个账号；
- AI for Science / 数学推理：至少 3 个账号。

## 参考账号的近期主题

用户提供的“AI大模型学习”主页目前显示约 16.8 万粉丝。按公开作品页从新到旧，可见：

- [工业级 AI 意图识别架构](https://www.douyin.com/video/7665339200710905126)
- [生产级 Agent 记忆系统](https://www.douyin.com/video/7664586374086954294)
- [一个视频讲透 AI Agent](https://www.douyin.com/video/7662006502680431887)
- [Vibe Coding 架构](https://www.douyin.com/video/7660139608916184358)
- [MCP vs CLI](https://www.douyin.com/video/7658654947852029210)
- [Loop Engineering](https://www.douyin.com/video/7655651382208351494)
- [Function Calling](https://www.douyin.com/video/7655268080490138934)
- [Skill 架构](https://www.douyin.com/video/7651613998131006774)
- [Skill 与 MCP](https://www.douyin.com/video/7649695126813445376)
- [Agent Memory](https://www.douyin.com/video/7632267180838522162)

这组标题说明：该账号不是在追逐冷门论文，而是在围绕 **Agent 工程栈** 连续拆概念。

## 跨创作者主题聚类

覆盖数量是基于本轮已核对样本的保守下限，不代表平台全量数据。

| 主题集群 | 已核对独立创作者下限 | 近期性 | 主流程度 | 与目标受众匹配 |
|---|---:|---|---|---|
| Kimi K3 / MoE / 开放权重 | B站 ≥5，抖音另有多账号覆盖 | 很强 | 很高 | 高 |
| GPT-5.6 / ChatGPT Work / 模型分层 | B站 ≥5，抖音 ≥4 | 很强 | 很高 | 高 |
| GPT-Live / 全双工语音 | B站 ≥5 | 强 | 高 | 很高 |
| Agentic Coding / Vibe Coding / Codex / Claude Code | 抖音样本 ≥6，跨平台更多 | 很强 | 很高 | 很高 |
| Agent Skill / MCP / CLI / Sub-agent | ≥6 | 强 | 高 | 很高 |
| Agent Memory / Context 管理 | ≥5 | 强 | 高 | 很高 |
| Physical AI / 世界模型 / VLA | 抖音样本 ≥4 | 很强 | 高 | 高 |
| Agent 安全 / 权限 / 沙箱 | 抖音样本 ≥3 | 强 | 中高 | 很高 |
| Loop Engineering | 历史覆盖 ≥6，但高峰在 6 月中下旬 | 衰减中 | 已过峰值 | 高 |
| Stateless MCP / AgentWorld / Harness Engineering | 尚未验证出足够近期覆盖 | 新 | 未通过 | 高 |

## 重新生成的正式候选

### 1. Kimi K3 × MoE

推荐标题：

> **Kimi K3 明明有 2.8 万亿参数，为什么还能这么便宜？MoE 到底省了什么？**

为什么进入正式池：

- B站近 30 天至少 5 个独立创作者覆盖；
- 本轮可核样本的累计播放保守超过 40 万；
- 抖音科技、媒体和 AI 账号也在密集讨论；
- “2.8 万亿参数”天然引出总参数、激活参数、专家路由和推理成本等概念。

我们的差异化：

- 不做跑分播报或国产情绪叙事；
- 解释 MoE 为什么“参数很多，但一次只激活一部分”；
- 区分总参数、激活参数、显存占用、吞吐和延迟；
- 解释开放权重不等于没有许可约束；
- 给 AI 产品经理一张模型成本与部署选型清单。

一手资料：[Kimi K3 官方仓库](https://github.com/MoonshotAI/Kimi-K3)

判断：**当前跨平台热度最强，适合作为第一条时效型黄金样例。**

### 2. Agentic Coding

推荐标题：

> **Agentic Coding 为什么不是 Vibe Coding 2.0？从聊天到执行到底变了什么？**

为什么进入正式池：

- 本轮 6 个重点抖音样本账号都出现 Agent、Codex、AI Coding、真实任务或工作流内容；
- 用户参考账号也覆盖 Vibe Coding、MCP、CLI、Agent 和 Loop；
- B站 Vibe Coding / Claude Code / Codex 系统课程已有大量观看；
- 受众正在从“AI 会写代码”转向“AI 能否承担完整任务”。

我们的差异化：

- 区分自然语言写代码、Vibe Coding 与 Agentic Coding；
- 解释规划、执行、工具、环境反馈、测试和恢复循环；
- 说明“会生成代码”为什么不等于“能交付产品”；
- 给 AI 产品经理一套任务授权、验收和人类接管框架。

判断：**最贴近抖音目标受众，也最适合作为长期栏目样例。**

### 3. GPT-Live × 全双工语音

推荐标题：

> **GPT-Live 为什么终于不像对讲机？全双工语音 AI 讲清楚**

为什么进入正式池：

- B站近 30 天至少 5 个独立创作者覆盖；
- 语音 Agent 正从“识别完—生成—播报”的轮次式体验向更自然的实时交互发展；
- 对客服、陪伴、会议和车载产品经理具有直接价值。

我们的差异化：

- 对比 STT → LLM → TTS 级联与端到端实时语音；
- 解释全双工、打断、回声消除、轮次判断和延迟预算；
- 说明自然并不等于安全，高风险操作仍需确认；
- 给出语音 Agent 的产品体验指标。

一手资料：[OpenAI：GPT-Live](https://openai.com/zh-Hans-CN/index/introducing-gpt-live/)

判断：**概念清楚、画面感强，适合第二条。**

### 4. AI 产品的模型选型：从跑分到任务成本

推荐标题：

> **为什么榜单第一的模型，可能不是产品里最好的模型？**

为什么进入正式池：

- 至少 5 个重点抖音账号近期讨论 GPT-5.6、Claude、Kimi、GLM 或国产替代；
- B站 GPT-5.6 实测、分层模型与 Kimi K3 测评均形成多账号覆盖；
- 热门内容已经从单纯跑分转向真实任务、价格、失败率和工作流。

我们的差异化：

- 用“每个成功任务的总成本”代替单次调用价格；
- 把失败重试、上下文长度、缓存、延迟、人工接管和合规纳入选型；
- 解释为什么不同环节应该使用不同模型；
- 给出一个可复用的产品选型表。

判断：**非常适合 AI 产品经理，且可借每次模型发布反复激活。**

### 5. Physical AI：世界模型、VLA 与机器人“大脑”

推荐标题：

> **WAIC 都在讲 Physical AI：世界模型、VLA 和机器人“大脑”是什么关系？**

为什么进入正式池：

- WAIC 后，本轮至少 4 个抖音样本账号持续覆盖具身智能、世界模型或 Physical AI；
- 属于已经破圈、但概念关系仍混乱的话题；
- 对软硬件结合、机器人产品和多模态交互有长期价值。

我们的差异化：

- 区分 Physical AI、Embodied AI、世界模型和 VLA；
- 用“感知—预测—决策—动作—反馈”画出闭环；
- 说明仿真训练、真实数据与 sim-to-real gap；
- 回答什么产品需要身体，什么产品只需要软件 Agent。

判断：**主流且有技术解释空间，但制作素材成本高于前三项。**

## 当前推荐

如果目标是抓住当前跨平台热度，第一条黄金样例改为：

> **Kimi K3 明明有 2.8 万亿参数，为什么还能这么便宜？MoE 到底省了什么？**

如果更重视抖音账号的长期栏目代表性，则选择：

> **Agentic Coding 为什么不是 Vibe Coding 2.0？从聊天到执行到底变了什么？**

两者都已通过“多个独立创作者近期覆盖”的门槛。前者更热、更适合快速上线；后者更耐久、更能代表未来栏目。

第二梯队常青候选：

- Agent Skill 与 MCP、CLI、Sub-agent 的分工；
- Agent Memory 与 Context 管理；
- Agent 安全、权限、沙箱和可逆操作。

## 数据局限

- 本轮属于公开页面人工初筛，不是抖音全量数据；
- 抖音未登录页面能看到的互动字段不完整；
- 部分精选页把账号近期作品展示在某一历史视频页面下，需要在正式建库时逐条记录；
- 绝对播放量不能跨账号比较；
- B站累计播放是检索时的样本快照，只用于验证讨论势能，不能视为平台全量；
- 下一步仍需把观察名单固定到 12～20 个账号，并记录每个账号近 20 条内容的中位数，才能计算可靠的“相对爆款指数”。
