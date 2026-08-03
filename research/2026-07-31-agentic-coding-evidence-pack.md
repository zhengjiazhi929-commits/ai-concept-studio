# 《Agentic Coding 为什么不是 Vibe Coding 2.0？》一手证据包

- 调研截止：2026-07-31（Asia/Shanghai）
- 证据范围：官方产品文档、官方工程博客、论文、基准官网或官方仓库
- 用途：黄金样例的事实底稿；不是成片口播稿
- 事实源原则：产品能力由产品官方资料证明；行业共性至少由两家产品交叉验证；能力边界由 benchmark、系统卡、官方限制文档证明

## 一、可以采用的核心定义

**建议定义（跨来源综合，不是任何一家厂商的原句）：**

Agentic Coding 是一种软件工程执行范式：语言模型不只返回代码文本，而是在受控的开发环境中，围绕一个较高层目标，自主选择下一步动作，读取代码库、制定或更新计划、修改文件、调用终端与其他工具、运行测试，并依据环境反馈继续修正，最后把可验证的变更交给人审查。

可将其压缩为：

> 代码补全交付的是“下一段代码”，Coding Chat 交付的是“对话中的答案”，Agentic Coding 试图交付的是“在真实环境里验证过的任务结果”。

这里的“自主”必须理解为**边界内的自主**，不是不需要人，也不是拥有无限权限。主流产品都在通过沙箱、权限、网络隔离、计划审批、日志、差异审查和 PR 流程限制其行动范围。

## 二、与 Vibe Coding 的严谨关系

“Vibe Coding”不是具有统一工程规范的正式技术分类，因此不要在视频中把它定义得过死。建议比较两个不同维度：

| 维度 | Vibe Coding | Agentic Coding |
| --- | --- | --- |
| 更接近什么 | 一种人机协作与开发方式 | 一种系统能力与执行架构 |
| 人主要在做什么 | 用自然语言表达意图，凭结果与体验持续提示 | 指定目标、验收条件、权限和人工闸门，监督任务执行 |
| 系统主要产出 | 对话中的代码或应用结果 | 带执行轨迹、测试证据或 PR 的任务结果 |
| 核心判断标准 | 人是否主要通过自然语言“凭感觉”驱动开发 | 系统是否拥有观察—行动—验证—纠错闭环 |

**关键边界：二者并非互斥。** 用户完全可能用一种很 “vibe” 的交互方式驱动一个 agentic coding 系统；也可能非常严谨地使用 coding agent。标题中的“不是 2.0”应表达“它增加了执行架构”，不能表达“二者毫无交集”。

## 三、来源与可支持事实

### 1. 代码补全阶段：GitHub Copilot 初次发布

- 来源：[Introducing GitHub Copilot: your AI pair programmer](https://github.blog/news-insights/product-news/introducing-github-copilot-ai-pair-programmer/)
- 日期：2021-06-29，更新于 2022-02-23
- 来源类型：GitHub 官方产品博客
- 可支持事实：最初的 Copilot 从当前编辑中的代码获取上下文，在用户输入时建议整行代码或整个函数。它的典型交互单元是“正在输入的代码”，主要输出是补全建议。
- 可用于：演进第一阶段，“AI 坐在光标后面预测下一段代码”。
- 边界：早期 Copilot 也能建议测试和完整函数，不能把“补全”说成只能生成一个 token；区别在于它不拥有端到端任务执行闭环。

### 2. 对话阶段：GitHub Copilot Chat 正式可用

- 来源：[GitHub Copilot Chat now generally available](https://github.blog/news-insights/product-news/github-copilot-chat-now-generally-available-for-organizations-and-individuals/)
- 日期：2023-12-29，更新于 2024-05-21
- 来源类型：GitHub 官方产品博客
- 可支持事实：Copilot Chat 把自然语言对话引入 IDE，可解释代码、发现安全问题、编写单元测试，并与原有代码补全并列提供。
- 可用于：演进第二阶段，“交互单元从光标补全变成了自然语言对话”。
- 边界：Chat 也可以触发有限动作，现代产品中 chat 与 agent 的界面正在融合；划分依据应是系统是否自主调用工具、消费结果并继续迭代，而不是界面上有没有聊天框。

### 3. Agent 阶段：OpenAI Codex 的隔离环境与测试闭环

- 来源：[Introducing Codex](https://openai.com/index/introducing-codex/)
- 日期：2025-05-16，能力说明更新于 2025-06-03
- 来源类型：OpenAI 官方产品与技术说明
- 可支持事实：Codex 被定义为云端软件工程 agent；任务在预载代码库的独立环境中运行，可以读写文件，调用测试、lint 和类型检查，并迭代运行测试直到通过。完成后会提供终端日志和测试输出供用户核验，并由用户审查、要求修改或创建 PR。
- 可用于：证明 Agentic Coding 的跃迁不只是“代码写得更长”，而是获得代码库、命令执行、验证、迭代和交付能力。
- 边界：该文是特定产品能力，不应据此声称所有 coding agent 都会持续运行到测试通过；“测试通过”也不等于需求完整正确。

### 4. 核心 Agent Loop：理解—行动—验证—继续迭代

- 来源：[Agents — Visual Studio Code](https://code.visualstudio.com/docs/agents/concepts/agents)
- 日期：2026-07-29
- 来源类型：Microsoft / VS Code 官方架构文档
- 可支持事实：官方将 agent 描述为能自主规划并执行编码任务的系统。典型循环包括理解、行动、验证；工具输出被加入下一轮上下文，系统会在编辑、测试、诊断失败、再次编辑之间循环，并在遇到错误时自我纠正。
- 可用于：本期最核心的机制图。建议画成：目标 → 理解代码库 → 计划/选动作 → 工具执行 → 环境反馈 → 验证 → 继续或交付。
- 边界：官方明确说明 agent loop 不是一套固定模板，不同项目和产品会定制；“规划”有时是显式计划，有时只是逐步决策，不应说每个 agent 都先生成完整计划。

### 5. 端到端交付链：Google Jules 的 VM、测试与 PR

- 来源：[Jules is here](https://jules.google/docs/changelog/2025-05-19/)；补充：[Jules Getting Started](https://jules.google/docs/)
- 日期：2025-05-19；动态文档检索于 2026-07-31
- 来源类型：Google 官方产品文档
- 可支持事实：Jules 接到任务后创建新的 VM 开发环境、安装依赖、编写测试、修改代码、运行测试并打开 PR；入门流程中，Jules 先生成计划，用户可以在写代码前审查批准。
- 可用于：用另一个厂商交叉验证“计划—环境—修改—测试—PR”不是某个产品的单点设计，而是 agentic coding 的代表性产品模式。
- 边界：计划审批可以依产品设置而变化；Google 文档将 Jules 称为 experimental coding agent，不能把其所有表现泛化为稳定行业能力。

### 6. 工具与环境为什么是分水岭

- 来源：[Tools — Visual Studio Code](https://code.visualstudio.com/docs/copilot/concepts/tools)
- 日期：2026-07-01
- 来源类型：Microsoft / VS Code 官方架构文档
- 可支持事实：没有工具时，模型只能生成文本；获得工具后，agent 可以读文件、写代码、运行终端命令、搜索代码库和连接外部服务。每次工具输出会进入上下文，成为下一次决策依据。
- 可用于：解释“模型会写代码”与“系统能完成工程任务”之间差的是工具、环境和反馈通路。
- 边界：工具越多不必然越好。官方指出工具会扩大模型的决策空间并消耗上下文，应只开放与任务相关的工具。

### 7. 人工监督不是附加项：计划审批、日志与 steering

- 来源：[Managing agent sessions — GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)
- 日期：动态文档，检索于 2026-07-31
- 来源类型：GitHub 官方文档
- 可支持事实：Copilot cloud agent 的 session 日志记录它理解代码库、修改和验证时使用的工具；临时开发环境可在推送前运行测试和 lint；用户可在 agent 方向错误时发送新指令 steering，也可以停止 session；提交可追溯到 session 日志。
- 可用于：解释人的角色从“亲手写每一行”迁移到“给目标、看轨迹、纠偏、验收”。
- 边界：GitHub 文档注明 steering 并非所有第三方 coding agent 都支持；审计可见性和控制能力必须按具体产品判断。

### 8. 权限与沙箱：自主性的前提不是无限授权

- 来源：[Beyond permission prompts: making Claude Code more secure and autonomous](https://www.anthropic.com/engineering/claude-code-sandboxing)
- 日期：2025-10-20
- 来源类型：Anthropic 官方工程博客
- 可支持事实：Claude Code 会导航代码库、编辑多文件并执行命令验证结果，这会带来 prompt injection 等风险。其沙箱用文件系统隔离与网络隔离定义 agent 可自由行动的边界；越界时提示用户确认。默认权限模式下为只读，修改或运行大多数命令需批准。
- 可用于：解释“越想让 agent 自主，越需要先把可行动边界工程化”。
- 边界：沙箱降低风险，不消灭风险。Anthropic 文档与 GitHub 防火墙文档均明确存在覆盖范围和绕过限制；不能说“进了沙箱就绝对安全”。

### 9. 恢复机制：自动纠错与人工回滚要分开说

- 来源：[Revert changes with checkpoints and editing requests — VS Code](https://code.visualstudio.com/docs/chat/chat-checkpoints)
- 日期：动态文档，检索于 2026-07-31
- 来源类型：Microsoft / VS Code 官方文档
- 可支持事实：VS Code agent 会创建可恢复的检查点，用户可以将工作区回退到会话中的已知状态，也能编辑之前的请求并撤销该请求之后的变更。
- 可用于：说明 recovery 至少包含两层：一是 agent 根据测试失败自动再迭代；二是平台给人提供停止、回滚、重做能力。
- 边界：checkpoint 是产品级人工恢复机制，不等于 agent 本身具备完美的故障恢复能力；不同 coding agent 的恢复实现不同。

### 10. 从“函数生成”转向“真实代码库 issue”：SWE-bench

- 来源：[SWE-bench 官方仓库](https://github.com/SWE-bench/SWE-bench)；论文：[Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770)
- 日期：论文 2023-10-10；官方仓库持续更新
- 来源类型：基准官方仓库与论文
- 可支持事实：SWE-bench 给系统一个真实代码库和 GitHub issue，要求生成能解决问题的 patch；原论文包含 2,294 个来自 12 个 Python 仓库的问题，解决问题经常需要跨函数、类和文件协调修改，并与执行环境交互。
- 可用于：解释评测单位从短代码题、单函数输出，迁移到 repository-level issue resolution。
- 边界：SWE-bench 衡量的是指定代码库问题修复，不覆盖从产品定义到上线运营的完整软件生命周期；分数也同时受模型、agent harness、工具和环境影响。

### 11. 从开源 issue 转向经济任务：SWE-Lancer

- 来源：[Introducing the SWE-Lancer benchmark](https://openai.com/index/swe-lancer/)
- 日期：2025-02-18，数据结果更新于 2025-07-28
- 来源类型：OpenAI 官方研究发布
- 可支持事实：SWE-Lancer 收录 1,400 多个真实 Upwork 软件工程任务，总实际报酬约 100 万美元，既包括独立工程任务，也包括管理决策任务；独立任务由端到端测试评分。发布时，前沿模型仍无法解决其中大多数任务。
- 可用于：证明 agentic coding 的评测正在接近真实经济工作，而不是只看“生成代码像不像答案”。也可作为“能力仍有明显边界”的证据。
- 边界：这是特定历史时间点、特定任务集合的结果，不能用来推导当前任一产品的精确成功率。

### 12. 终端中的长动作链仍是难点：Terminal-Bench

- 来源：[Introducing Terminal-Bench](https://www.tbench.ai/news/announcement)；2.0 论文：[Benchmarking Agents on Hard, Realistic Tasks in Command Line Interfaces](https://arxiv.org/abs/2601.11868)
- 日期：初版 2025-05-19；2.0 论文 2026-01-17
- 来源类型：基准官网、官方论文与仓库
- 可支持事实：Terminal-Bench 用独立的 Docker 环境、人工验证方案和测试来评估 agent 在终端中的复杂端到端任务。2.0 包含 89 个真实工作流启发的困难任务，论文报告前沿模型与 agent 的得分仍低于 65%。官方还归纳了长动作链、长上下文、在限制内自主行动与敏感操作安全等困难。
- 可用于：说明“会调用终端”不等于“能稳定完成长链任务”；工具能力越强，可靠性与安全问题越重要。
- 边界：Terminal-Bench 不只测编码，也包含系统、科学计算等终端任务；不要将其得分直接称为“写代码成功率”。

### 13. 评测对象其实是模型 × Harness × 环境

- 来源：[Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- 日期：2026-01-09
- 来源类型：Anthropic 官方工程方法文章
- 可支持事实：多轮 agent 评测向系统提供任务、工具和环境，让其执行包含工具调用与推理的循环并改变环境，再依据最终环境状态评分；Anthropic 明确区分 agent harness 与模型，并指出评测“agent”时实际评测的是 harness 与模型的组合。
- 可用于：本片重要产品结论——选 coding agent 不能只看底层模型榜单，还要看工具、上下文组织、执行环境、权限、验证和恢复组成的整套系统。
- 边界：不同 harness 对同一模型的表现可能不同，不能把单个产品结果归因于模型本身。

### 14. 单一 benchmark 不能等同真实能力

- 来源：[Separating signal from noise in coding evaluations](https://openai.com/index/separating-signal-from-noise-coding-evaluations/)
- 日期：2026-07-08
- 来源类型：OpenAI 官方评测审计
- 可支持事实：OpenAI 审计 SWE-Bench Pro 后估计约 30% 的任务存在破坏性问题，包括过严测试、提示信息不足、测试覆盖不足或提示误导，并撤回此前推荐。
- 可用于：提醒观众不要把一次榜单成绩直接翻译成真实交付率；真实产品评估还应看自家任务、环境和验收条件。
- 边界：该结论针对被审计的 SWE-Bench Pro 数据，不代表所有 coding benchmark 都无效；正确表述是“榜单需要审视数据与评测设计”。

### 15. 生产级 Agentic Coding 依赖持续建设 Harness

- 来源：[Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- 日期：2026-02-11
- 来源类型：OpenAI 官方工程实践
- 可支持事实：文章描述将测试、验证、审查、反馈处理和恢复逐步编码进系统后，agent 才能从单一提示端到端推动新功能；示例链路包括复现问题、实现修复、驱动应用验证、开 PR、回应反馈、处理构建失败、必要时升级给人。文章同时明确，这依赖特定代码库结构和工具投入，尚不能假设自动泛化。
- 可用于：这条视频最有价值的收束——Agentic Coding 的竞争不只在“模型聪明多少”，也在组织是否把知识、工具、验收、护栏与反馈做成可执行基础设施。
- 边界：这是 OpenAI 单个内部项目的工程经验，不是所有团队都应照搬其合并策略或自治程度。

## 四、可以放心使用的事实表达

1. **“Agentic Coding 的分水岭不是代码长度，而是系统是否能在真实环境中闭环。”**
   - 依据：VS Code agent loop、Codex、Jules、Anthropic evals。

2. **“核心循环不是一次生成，而是理解、行动、验证，再依据反馈继续。”**
   - 依据：VS Code Agents 2026-07-29。

3. **“工具和环境把语言模型从回答者变成行动者。”**
   - 依据：VS Code Tools、Codex、Jules。

4. **“更高自治必须与更清楚的权限、沙箱、审计和人工闸门同时出现。”**
   - 依据：Anthropic sandbox、GitHub session/firewall、Jules plan approval。

5. **“真实评测正在从单函数代码题转向代码库 issue、终端任务和真实经济任务。”**
   - 依据：SWE-bench、Terminal-Bench、SWE-Lancer。

6. **“Coding agent 的能力是模型与 harness、工具、环境共同产生的。”**
   - 依据：Anthropic agent evals、OpenAI harness engineering。

## 五、禁止或需要降级的表达

| 不建议说 | 建议改成 |
| --- | --- |
| Agentic Coding 已经可以取代程序员 | 它正在接管更多有明确目标和验收条件的执行环节，但复杂任务仍需要人定义、监督和验收 |
| Agent 会自己把整个软件做完 | 部分产品可在边界清晰的任务上完成从修改到测试与 PR 的链路，成功高度依赖环境、工具和任务定义 |
| 测试通过就代表代码正确 | 测试是可执行反馈，但可能覆盖不足、过严或与真实需求错位 |
| 进了沙箱就绝对安全 | 沙箱和权限降低风险并限制影响范围，但仍有覆盖盲区与潜在绕过 |
| Agentic Coding 和 Vibe Coding 完全相反 | 前者描述执行架构，后者更多描述使用方式；它们可以重叠 |
| SWE-bench 分数就是实际开发成功率 | 它只衡量特定数据集、环境和 agent scaffold 下的任务解决表现 |
| Agent 都会先做完整计划 | 有些产品支持显式计划审批，另一些只在循环中逐步选择下一步 |

## 六、建议的机制模型（供脚本和分镜使用）

可以把 Agentic Coding 拆成六层，而不是只画一个“AI 大脑”：

1. **目标层**：任务描述、约束、验收条件。
2. **上下文层**：代码库、issue、文档、历史变更、项目规则。
3. **决策循环**：理解当前状态、拆解任务、选择下一动作、根据反馈调整。
4. **工具层**：搜索、读写文件、终端、测试、浏览器、Git、MCP/API。
5. **执行与反馈层**：真实或隔离开发环境、编译器、测试、lint、类型检查、CI。
6. **治理层**：权限、沙箱、网络策略、日志、checkpoint、人工审批与 PR 审查。

其中第 3–5 层组成技术闭环，第 6 层决定这个闭环能否安全地进入生产。

## 七、给 AI 产品经理的判断问题

1. 我们交给 agent 的任务单位，是“写一段代码”还是“完成一个可验收的变更”？
2. Agent 看到的代码库、依赖和运行环境，离真实生产环境有多近？
3. 什么信号代表完成：测试、界面行为、性能、安全扫描、还是业务规则？
4. 测试失败、环境异常或需求歧义时，系统会重试、换策略、回滚还是升级给人？
5. 哪些操作自动允许，哪些必须人工确认？网络、密钥和外部系统如何隔离？
6. 能否看到完整行动轨迹、测试证据和差异，并把人工反馈送回下一轮？
7. 评测的是底层模型，还是实际交付给用户的“模型 + harness + 工具 + 环境”？

## 八、推荐的成片事实主线

1. 先用“补全 → 对话 → 任务闭环”解释演进，而不是罗列产品。
2. 用一个 bug 修复动画展示：读 issue → 搜索代码 → 提计划 → 修改 → 跑测试 → 失败 → 诊断 → 再修改 → 通过 → PR。
3. 再拆出 agentic coding 的六层系统，让观众明白关键不只是模型。
4. 用权限和沙箱解释为什么“自主”必须是边界内自主。
5. 用 SWE-bench、SWE-Lancer、Terminal-Bench 说明评测为何从“答案像不像”转向“任务是否真的完成”。
6. 最后用现实限制收束：长链可靠性、需求和测试错位、环境差异、安全、成本与 benchmark 缺陷。

