# Agent 先找选题：受控公开发现流程

新视频的默认起点是 Agent 发现选题，不是先要求用户填写主题。Agent 发现并解释候选，用户选择后才创建一期并进入 Research；五个人审 gate 保持不变。

## 一次性的本地授权

在 `studio/` 使用锁定的 Node/pnpm。用户已明确授权免费公开发现后，执行：

```sh
pnpm discovery:setup -- --actor human:Zhengjiazhi --confirm-public-discovery
```

此命令生成 Git 忽略的 `.local-public-discovery/identity.json`：私有目录 0700、文件 0600、当前 UID、拒绝符号链接/覆盖。密钥不输出、不写进文档。不设置通用 HTTP operator，也不启动会恢复旧 Episode 的服务。

仅允许公开采集、辅助批次导入、Radar 三种实际操作；grant 有效期五分钟，模型调用和费用预算为零。HTTP 公共页面请求仍可能发生，零模型调用不等于零网络请求。grant 不能复用于选题批准、直接写 signal、历史 seed 或生产 gate。完整 operator 环境也可授权，部分配置必须失败，不退回其他身份。

## 每期的执行顺序

```sh
pnpm topic:discover
```

1. 程序读取配置入口并记录可达性。固定视频链接只证明这一页是否可读，不代表已发现作者新作。
2. 生成 `data/collector/assist-task.json` v2：全部启用作者、近 30 天窗口、原作品证据要求及续跑模板。
3. 同一 Codex 任务按清单公开检索并核对原作品，保存 v2 JSON 到 `data/collector/inbox/`。明确记录已核验、受限、无法核验和未扫描；只有确实遍历可核验作品列表才可标记 `no_recent_items`。
4. 续跑（不重新生成任务 ID）：

```sh
pnpm topic:discover -- --batch <批次文件名.json>
```

续跑先校验并导入，再重新计算 Radar，零条接受结果也重算，避免展示旧榜单。不在 CLI 内偷偷调用 LLM 或浏览器账号；需要 Codex 续跑会显式输出 `continuation`，不是无人值守采集完成。没有创建定时任务。

| 状态 | 含义 |
| --- | --- |
| `awaiting_public_discovery` | 发现任务已生成，需 Codex 读取公开原作品 |
| `needs_more_evidence` | 本轮已导入/记录，但没有达到正式候选门槛 |
| `awaiting_topic_selection` | 有正式候选，可交由用户选择；尚未选择、未批准研究 |

## v2 的证据边界

批次绑定当前 `discoveryTaskId`、最近 48 小时观察时间和任务窗口；标题必须对应原作品 URL，不能是搜索页。每条观察保留作者名、原页面日期文字、短摘录、时间精度和概念映射。缺少指标保持缺失。

作者有可核对账号链接时保留 `authorUrl`。只有配置没有绑定具体账号、原作品署名精确匹配配置、摘录保留署名和日期时，才允许 `authorUrl:null` 加 `identityBasis:"original-work-byline"`。这是较弱身份依据，不证明实名所有权或绝对账号独立性；若配置已绑定账号 URL，不能用署名回退绕过账号匹配。疑似转载、重名或署名不一致留待核验。

只展示日期的页面保存 `page-date`，并核对日期原文和 `publishedAt` 在中国时区同日；序列化的午夜不是发布时间精确到秒。相对天数必须保留原文与 `evidence.dateReferenceAt`，两者换算一致才允许 `relative-day-estimate`，不可解析时留待核验。靠近滚动窗口边界时保守排除，不把抓取时间替换成发布日期。搜索摘要、推荐列表时间和聚合站日期只能作线索，不能冒充原作品日期。

已尝试作者必须有 `sourceChecks`，记录 `verified / no_recent_items / blocked / unverified` 及原页面。没有扫描的作者保留 `notScanned` 计数；局部检索没有结果不能说明市场没有讨论。不可核验的观察不入候选，已核验但未知概念进入 `pendingReview`，不强行映射。

## 新旧数据、评分与确认

- 保留历史信号；默认 Radar 不再自动导入 2026-08-03 seed。只用合法发布日期且位于当前窗口的证据生成候选，拒绝未来或缺失日期。
- CLI 默认只接受 v2。v1 兼容迁移必须显式 `pnpm import:collector -- --legacy-import <文件名.json>`，标记为历史导入，不作为近期发现证据。组合 workflow 不接受 legacy。
- 已核验 v2 不被后来 v1 导入降级；新 v2 纠正旧条目时，事实与证据一起更新并保持稳定 ID。不能复用别的作者 ID；指标仅在同一已核验作品间按已观测字段合并，不累加、不跨作品继承。
- 正式门槛仍为 14 天 3 个独立来源组或 30 天 5 个，非事件主导、概念独立、已知维度分至少 70、未进入过生产。不会为凑推荐降低门槛；`fresh` 仅代表有近期数据，不等于可立项。
- 作者内容是选题信号，不是技术结论。选题确认后，Research 仍须官方文档、论文或原始项目。
- 评分引擎只知道当前 checkout 的 Episode 历史。其他工作树已有的视频不能靠猜测变成新 Episode；人工选择前需核对已制作主题，跨工作树迁移另行处理。

批次在任何信号写入前通过跨进程锁持久占用 `data/collector/claims/<batchId>.json`，保存完整输入和哈希。相同 ID 只能有一个写入者；失败 claim 留存并拒绝自动重放，需检查记录和下游状态后处理，不随意换 ID 再导入。这是并发冲突隔离与失败追溯，不是跨 Collector/Trend 两个 store 的全事务回滚。

测试使用隔离身份和合成 store；真实公开发现结果属于 ignored runtime 数据，不提交密钥、批次和媒体。
