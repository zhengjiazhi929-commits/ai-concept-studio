# AI Concept Studio 对话上下文交接包

生成时间：2026-08-03（Asia/Shanghai）

这个目录用于把当前对话中的项目背景、用户意图、关键决策和实时进度交给新的 Codex 对话或新电脑继续处理。它是可执行的工作摘要，不是逐字聊天记录。

## 建议阅读顺序

1. `CONTEXT.md`：完整项目上下文与当前状态；
2. `DECISION-LOG.md`：已经确认和已经否决的方向；
3. `NEXT-STEPS.md`：从当前断点继续的操作顺序；
4. `RESUME-PROMPT.md`：可直接复制到新 Codex 对话的续接提示词；
5. `MANIFEST.json`：供程序读取的包信息。

## 安全边界

本包不包含密码、Cookie、API Key、GitHub/微软访问令牌、隐藏指令或内部推理。账号登录状态需要在新电脑重新建立。

项目私有仓库：<https://github.com/zhengjiazhi929-commits/ai-concept-studio>

