# 人工指定选题：本地受控入口

日期：2026-09-10。适用：用户已明确指定 Radar 中的主题，但不把该决定伪装为自动热度门槛达标。
代码与验收状态以 `STATUS.md` 为准。

## 使用

在 `studio/` 中先预览（只读、无授权签发、无 Episode 创建）：

```sh
pnpm topic:select --candidate context-engineering-memory
```

核对输出的候选、历史 Radar 时间、来源不足和 `runId`/`snapshotHash`。得到人工确认后，
使用该次预览的精确值执行；下面尖括号是占位符，不能原样执行：

```sh
pnpm topic:select --candidate context-engineering-memory \
  --run '<预览的 runId>' --snapshot '<预览的 snapshotHash>' \
  --actor human:Zhengjiazhi \
  --reason '用户明确指定本期主题；保留来源覆盖不足的事实' \
  --confirm-manual-selection
```

未知、重复、缺值参数全部拒绝。不提供数据根、模型预算、通用 scopes 或权限覆盖参数。
没有确认全部字段时不能执行。`actor` 是操作系统用户显式声明的编辑者，不是账号登录认证；
本地 CLI 依赖当前工作区和 OS 访问边界，不作为远程 API 暴露。

## 权限与证据

- 每次执行只签发进程内一次性 Capability，5 分钟、零模型调用、零费用；
  `manual-topic/<完整请求 SHA-256>` 绑定 actor、理由、candidate、run、snapshot 和确认。
- 实际写入口固定 `trend:manual-select`，只允许状态/文件写入；不能委派研究、审批、
  发布或付费操作。不读取、不扩大现有 public-discovery identity，也不配置 HTTP token。
- 快照保留完整 Radar run 和该候选展示的最多 10 条信号的完整原始记录（含存在的
  署名、日期原文、摘录、采集 provenance）。明确说明这是 Radar 展示子集，不称完整作者扫描。
- 原 run/latest 的字节、分数、recommendedPool、来源组及缺失指标都不变；
  `selection.json`、Episode 与后续研究包独立标记 `selectionMode:manual`，保存决定与快照哈希。

## 持久化与恢复

1. 请求校验和 Capability 校验在所有写入前执行。
2. 在与 Radar/普通选择共用的 durable trend lock 内核对快照，写入不可变
   `studio/data/trends/manual-selections/<decisionId>.json`，记录 prepared 意向与固定 Episode ID。
3. 通过现有 Episode 合同、版本与 CAS writer 创建研究草稿。五道人审 pending，研究版本 0，
   仅研究步骤 ready，不代表研究内容已执行或获批。
4. 最后发布派生 selection 指针。指针失败返回 `committed_with_warning`，不能声称完全未执行。

同请求重试沿用同一记录与 Episode ID。已有 Episode 必须匹配固定 ID 和完整不可变选题来源；
已有研究/审批进度不重写。只允许恢复该已验证决定自身的缺文件目录，其他坏 Episode 仍报错。
指针已被更新的其他选择替代时返回 `committed_selection_superseded`，不把旧指针写回。
同 decisionId 的指针内容损坏则明确冲突，不悄悄继续。

普通选择与人工选择互查同概念预留，包含已离开全局 selection 指针的持久人工记录，
避免两条入口重复建任务。更改已经指定的概念/理由、取消 prepared 或重新制作已覆盖主题，
不属于该入口的隐式功能，需要单独的显式恢复/取消流程；不要手工删除审计记录解锁。

## 验证、停用与交付

使用临时数据根、合成信号和真实 CAS writer 跑授权、证据漂移、同请求并发、
建目录后失败、Episode 提交后指针失败、损坏记录、反向重复和研究 provenance 回归。
不能拿 live Episode 作为 fixture。修改被加入运行时实现哈希，旧评测不得沿用；准入等级不变。

停用为停止调用 `topic:select`；数据与审计保留。此入口不自动启动付费研究、生成素材、
渲染、提交 Git 或发布；研究、脚本、分镜、素材/声音和最终成片仍逐项审批。
