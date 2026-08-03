# 来源登记表

- 调研截止：2026-07-31
- 详细摘录：`research/2026-07-31-agentic-coding-evidence-pack.md`
- 原则：竞品创作者只证明市场热度，不证明技术事实；关键事实只使用官方资料、论文和基准官方资料。

| ID | 来源 | 日期 | 类型 | 主要支持 | 使用限制 |
|---|---|---:|---|---|---|
| S01 | [GitHub Copilot 初次发布](https://github.blog/news-insights/product-news/introducing-github-copilot-ai-pair-programmer/) | 2021-06-29 | 官方产品博客 | 早期典型交互是基于当前代码给出整行或函数建议 | 不能说补全只能生成一行，也不能代表当前全部能力 |
| S02 | [GitHub Copilot Chat 正式可用](https://github.blog/news-insights/product-news/github-copilot-chat-now-generally-available-for-organizations-and-individuals/) | 2023-12-29 | 官方产品博客 | 自然语言对话进入 IDE，可解释代码、写测试等 | 现代 Chat 和 Agent 的界面已融合，不能只按界面分类 |
| S03 | [Introducing Codex](https://openai.com/index/introducing-codex/) | 2025-05-16 | 官方产品说明 | 独立环境、读写文件、执行测试、迭代、日志与人工审查 | 只能证明该产品能力，不能泛化到所有 Coding Agent |
| S04 | [Agents — Visual Studio Code](https://code.visualstudio.com/docs/agents/concepts/agents) | 2026-07-29 | 官方架构文档 | 理解—行动—验证循环；工具结果进入下一轮并支持纠错 | Agent loop 没有唯一固定模板，显式完整计划并非必需 |
| S05 | [Jules 官方文档](https://jules.google/docs/) | 动态文档 | 官方产品文档 | VM 环境、计划、修改、测试与 PR 的端到端链路 | 具体审批和稳定性按产品设置判断 |
| S06 | [Tools — Visual Studio Code](https://code.visualstudio.com/docs/copilot/concepts/tools) | 2026-07-01 | 官方架构文档 | 工具让模型能读写文件、运行命令并消费真实反馈 | 工具越多不一定越好，会增加选择空间与上下文成本 |
| S07 | [GitHub：管理 Agent Sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents) | 动态文档 | 官方文档 | 会话日志、测试、纠偏、停止和可追溯提交 | 不同第三方 Agent 的控制能力不一致 |
| S08 | [Anthropic：Claude Code 沙箱](https://www.anthropic.com/engineering/claude-code-sandboxing) | 2025-10-20 | 官方工程博客 | 文件与网络隔离、越界确认、边界内自主 | 沙箱降低风险但不能保证绝对安全 |
| S09 | [VS Code Checkpoints](https://code.visualstudio.com/docs/chat/chat-checkpoints) | 动态文档 | 官方文档 | 人可以回退到会话检查点并重做 | 平台回滚不等于 Agent 自身有完美恢复能力 |
| S10 | [SWE-bench 官方仓库](https://github.com/SWE-bench/SWE-bench) / [论文](https://arxiv.org/abs/2310.06770) | 2023-10-10 | 基准与论文 | 用真实代码库 issue 评估跨文件 patch 与环境交互 | 不覆盖完整软件生命周期；结果受 scaffold 影响 |
| S11 | [SWE-Lancer](https://openai.com/index/swe-lancer/) | 2025-02-18 | 官方研究发布 | 真实自由职业软件任务与管理决策任务 | 结果属于特定时间、模型和任务集 |
| S12 | [Terminal-Bench](https://www.tbench.ai/news/announcement) / [2.0 论文](https://arxiv.org/abs/2601.11868) | 2025-05-19 / 2026-01-17 | 基准与论文 | 在隔离终端环境测试困难的端到端任务和长动作链 | 不只测编程，分数不能称为“写代码成功率” |
| S13 | [Anthropic：Agent Evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 2026-01-09 | 官方工程方法 | 实际评测的是模型与 Agent harness 的组合 | 不同 harness 结果不可直接归因于模型 |
| S14 | [OpenAI：Coding Eval 审计](https://openai.com/index/separating-signal-from-noise-coding-evaluations/) | 2026-07-08 | 官方评测审计 | SWE-Bench Pro 部分任务存在测试或提示问题 | 结论只针对该数据集，不代表所有 benchmark 无效 |
| S15 | [OpenAI：Harness Engineering](https://openai.com/index/harness-engineering/) | 2026-02-11 | 官方工程实践 | 测试、反馈、审查、恢复和代码库可读性共同支撑端到端执行 | 单一内部项目经验，不能直接泛化所有团队 |

## 来源覆盖结论

- 定义与机制：S03～S06，跨 OpenAI、Microsoft/VS Code、Google；
- 人工监督与安全：S07～S09，跨 GitHub、Microsoft、Anthropic；
- 任务级评测与限制：S10～S14；
- 生产落地条件：S13、S15。

关键主张均有一手资料支持；“Vibe 与 Agentic 是两个维度”作为作者分析单独标识，不冒充官方定义。

