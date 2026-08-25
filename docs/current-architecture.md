# 当前架构

更新时间：2026-08-25

## 产品视角

系统把“AI 给建议”和“系统真的执行”分开：Agent 只能提出或执行 Kernel 已允许的窄动作；
Workflow Kernel 决定下一步是否合法，Episode 保存结果，人类在五个关键节点决定是否放行。

```text
公开信号 / 固定输入
  -> Collector / Trend
  -> Research -> 人工研究 Gate
  -> Script -> 机器审核 -> 人工脚本 Gate
  -> Storyboard -> 机器审核 -> 人工分镜 Gate
  -> Assets + Voice -> 机器审核 -> 人工素材/声音 Gate
  -> Remotion Render -> QA -> 人工最终成片 Gate
  -> 本地导出（默认不发布）
```

## 核心模块

| 责任 | 当前实现 | 业务含义 |
|---|---|---|
| 单期状态 | `studio/data/episodes/<id>/episode.json` | 一期做到哪、用的哪个版本、是否获批 |
| 流程控制 | `src/server/control/workflow-kernel.mjs` | 决定此刻哪些动作合法 |
| 编排和恢复 | `src/server/orchestrator.mjs` | 运行 Worker、CAS 提交、恢复中断、失效下游 |
| Agent 注册 | `src/server/agents/registry.mjs` | 每个阶段的确定职责和输出合同 |
| 模型路由 | `src/server/control/model-router.mjs` | 只从已注册、已授权、预算可判定的候选选择 |
| 费用账本 | `src/server/control/budget-ledger.mjs` | 预留、结算、歧义冻结与人工对账 |
| 审核协调 | `src/server/reviews/` | 独立 Rubric、机器报告、版本哈希绑定 |
| 身份与授权 | `src/server/security/` | localhost 操作员 session、CSRF、一次性 Capability |
| 生产产物 | `src/server/production/` | 版本化脚本、分镜、素材、旁白及来源证明 |
| 视频 | `src/video/`、`src/server/renderer.mjs` | Remotion 合成和不覆盖的版本化 MP4 |
| QA | `src/server/qa.mjs` | 编码、尺寸、时长、哈希和内容质量检查 |
| 审计 | `src/shared/audit-log.mjs` | 脱敏、顺序和 hash-chain 保护的事件账本 |

## 信任边界

```text
浏览器 / 外部网页（不可信）
    | 结构、URL、大小、SSRF 校验
    v
本地 HTTP API -- 操作员 session + CSRF --> 人工决定
    |
    v
Workflow Kernel -- 一次性 Capability --> 文件 / Provider / 渲染副作用
    |
    +--> Episode CAS 状态提交
    +--> append-only 审计证据
```

- 浏览器传来的 actor、路径、费用、Provider 结算和审批绑定都不能直接信任。
- 外部网页文字只能成为数据，不能成为系统/开发者指令或高权限工具参数。
- Worker 不能签发 Capability、扩大预算、批准 Gate 或改变控制模式。
- 上传事务先写不可公开的私有 staging 和恢复 marker，再用同文件系统 hard-link 原子公开；
  上传、Episode CAS 与启动恢复共用互斥锁，恢复会复核 inode、bytes、SHA-256 和 Episode 引用。
- 上传媒体除格式头外还由本地受限 ffprobe/ffmpeg 检查轨道、编码、尺寸、时长并有限解码；
  该原生解析器边界尚不是 OS 级沙箱。
- 权限升级只允许按 `shadow -> assisted -> active` 的顺序；任何已启用模式仍可显式降级，
  fixed fallback 始终保留。

## 数据与产物

| 类型 | 位置 | Git 策略 |
|---|---|---|
| 产品/治理文档 | `docs/` | 跟踪 |
| 固定黄金输入 | `episodes/golden-001/` | 跟踪，合法小型资产 |
| 测试 Fixture | `studio/tests/fixtures/`、`studio/public/test-fixtures/` | 跟踪、不可变 |
| 当前 Episode | `studio/data/episodes/` | 黄金样例可跟踪；普通运行数据忽略 |
| Provider/审计运行状态 | `studio/data/` | 忽略，不含秘密 |
| 旁白、MP4、QA 图板 | `outputs/`、`studio/public/episodes/` | 忽略；用 manifest 记录相对路径和 SHA-256 |
| 本地模型/依赖 | 用户缓存、`node_modules` | 忽略 |

## 当前部署形态

单用户、localhost、本地文件和本地 Chromium。没有多租户、云端任务队列、自动发布或计费
系统。未来 Web 化必须重新做身份、租户隔离、对象存储和队列设计，不能把当前 localhost
信任假设直接搬到公网。
