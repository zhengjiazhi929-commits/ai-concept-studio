# 旧备份分支交付核对

核对日期：2026-10-24（Asia/Shanghai）。本文件记录历史交付对账，不是新一轮全仓安全审计、视频验收或合并批准。

## 结论与范围

两条本地备份分支中的有效代码与通用文档已经通过拆分提交进入 main；
**没有发现需要再次补传的运行代码或通用文档**。旧提交不在远端分支的祖先链上，不等于对应改动没有交付。

本轮授权仅为检查旧提交、补交仍有价值且确实缺失的代码/文档，排除视频内容、运行数据与敏感文件，
不合并 main。本轮实际变更只有本报告、逐路径证据清单和 STATUS，没有 cherry-pick 旧代码、恢复历史审批、删除或推送备份分支。

核对对象：

- `codex/agent-v2-remediation-20260824`：`5c9606be5dc5375ef9e2be742ebd9feed7193538`。
- `codex/remediation-integration-snapshot-20260825`：`cb144056c8b90e1a41c3b302a50f5683b794059d`。
- 第二条是第一条的历史前缀，共 **13 个唯一旧提交**，不是两组独立待补内容。
- 合并后的拆分交付快照：`857a4a266259b1dbf0592a1f9c2327b5387198e8`，已是 main 的祖先。
- 核对时 origin/main：`000a9901779a71f0670d5fa8e2ccf17f0ffd8c9e`。
- 核对时工作分支：`codex/video-discovery-20261022`，
  HEAD 与 origin 同名分支均为 `374a878cbfd65218adf1ee0a511d773b3207d2fa`。

**注意：最新的 374a878 通用修复已上传 GitHub 工作分支，但尚未合并 main。**
“旧分支内容已在 main”不代表“最新工作分支已合并”。新机器要取得最新交付，应检出该工作分支；
安装与验证参见[新机器接续说明](new-machine-setup.md)。

## 完整覆盖口径

以旧备份分支与 main 的公共祖先 `b29ebe911e2256bdf14fa4fa25aaa04bfeac075c`
到旧分支 tip 的差异为清单，共 **186 个路径**。

- 181 个路径在旧分支 tip 与已经合入的拆分快照中，Git 文件 blob 完全相同。
- 4 个不同 blob 已逐项解释如下；不是遗漏。
- 1 个 live Episode 状态文件刻意排除，不移植历史批准。
- 因此范围内 **185/185 路径完成历史交付核对**；范围外 1 个明确记录排除原因。
  这不是 185 个当前文件的全新功能/安全审查结论。
- 全部 186 个路径在核对时的工作分支仍存在；后续演进不等于历史代码丢失。

审查入口自动分组为 145 个路径，另有 41 个被默认过滤；后者已人工分流：
40 个文档、测试 fixture、启动器与环境模板补入范围，1 个 live Episode 排除。
没有把默认过滤当作“已检查”。

逐路径路径名、Git blob、版本引用与分类见
[不可变核对清单](evidence/legacy-branch-reconciliation-20261024.json)。
清单仅包含版本元数据，不包含 Episode 正文、凭据、媒体或本期讲稿。

## 13 个旧提交的处理

| 旧提交 | 已交付对应关系 / 实际含义 | 本次处理 |
| --- | --- | --- |
| cec7b54 | 运行安全修复由 588cdbe 交付；30/30 文件落地 blob 相同 | 已交付，不重放 |
| f08a786 | fixture 隔离由 94b3952 交付；47/48 blob 相同，剩下 1 个实际隔离补丁相同 | 已交付，保留更新测试基线 |
| 71e3dae | 治理与状态文档；与 017dbdd 补丁等价 | 已交付 |
| 9906cde | 本地整改；与 f844ae4 补丁等价 | 已交付 |
| 38d4206 | golden research gate 修复；与 a062a78 补丁等价 | 已交付 |
| a7e02ff | 18 个通用文档由 b914019 原样纳入；另有旧 golden 状态及 STATUS | 文档已交付；不移植旧状态 |
| 1a2aca8 | 旧快照 538/538 验证记录 | 历史证据，不覆盖当前验证 |
| 297c8c4 | 旧 Research v1 人工批准及准备 Script | 历史业务状态，不恢复 |
| 38e1670 | 旧批准后的 33/33 检查与审计记录 | 历史证据，不冒充当前结论 |
| 221cb5c | 旧 Script v1 人工批准及准备 Storyboard | 历史业务状态，不恢复 |
| c8532b3 | 旧 STATUS 引用脚本批准提交 | 历史记录，不覆盖当前状态 |
| cb14405 | 32 个代码路径由 d73550c、8 个 CI/依赖/启动器路径由 4ba99b3 交付；7 个通用文档由 7da0324 原样纳入 | 全部通用内容已交付 |
| 5c9606b | 当时集成快照与拆分交付授权说明 | 历史操作记录，不作为今日授权 |

`git cherry` 显示 3 个补丁等价、10 个未匹配旧 patch ID。逐路径核对证明后者包含拆分、
更新基线及旧业务状态，**不能解读为 10 项功能未上传**。对应通用提交均已验证为核对时 main 和工作分支的祖先。

## 4 个 blob 差异的解释

| 路径 | 差异原因 | 为什么不能直接覆盖当前文件 |
| --- | --- | --- |
| .github/workflows/verify.yml | 拆分交付后来更新固定 SHA 的 checkout/setup-node Action 版本 | 旧文件会退回较早 CI 配置 |
| studio/tests/ci-governance.test.mjs | 同步上述 Action SHA 与版本断言 | 应匹配当前 workflow，不恢复旧断言 |
| studio/tests/agent-skill-long-review.test.mjs | 对应提交已带入更新的平面节点、章节进度与 Remotion spring 测试基线；原 fixture 隔离的 15 行实际增删相同 | 隔离行为未漏；覆盖会抹掉后续视觉测试 |
| docs/STATUS.md | 旧生产批准、验证和拆分操作的时点快照；后由 6f3bc87、857a4a2 及后续状态更新接续 | STATUS 是当前真源，不恢复旧审批或旧测试结论 |

两份 fixture 隔离补丁去除文件头及 hunk 位置信息后，实际增删内容 SHA-256 同为
`fae0695055c28edec7a19ba7410b64cc0dda73c3dff41ac298fc3189d6ba1ae7`。

## 排除与验证边界

唯一范围外路径为 `studio/data/episodes/golden-001/episode.json`：
它携带旧版本研究/脚本批准及工作流状态，不是可移植代码，不得将旧批准当成当前批准。
原有五份 collector/trends tracked 运行数据不暂存；本期内容、outputs、凭据和本机 HANDOFF 不上传。
旧备份分支保留原状。

本轮是 **R0 文档交付**。验证包括引用、JSON 清单计数/唯一性/分类、Git 对应关系、秘密扫描和 diff 格式检查。
另外针对已解释的 CI/视觉测试差异执行现有聚焦测试；具体结果由 STATUS 记录。
运行实现仍为 v22，未改运行代码、依赖、布局或生产状态。

已有基线验证是 374a878 对应的干净安装与 2084/2084 验证，以及精确绑定该 SHA 的
[GitHub CI 成功记录](https://github.com/zhengjiazhi929-commits/ai-concept-studio/actions/runs/39976068022)。
这些不能冒充本轮文档提交的新 CI 或任何视频视觉验收。后续提交的 CI 必须按其新 HEAD 单独核对。

可复核命令（完整本地历史存在时；新机器未获取旧备份引用时以清单元数据为准）：

```sh
git merge-base --is-ancestor 857a4a2 000a990
git cherry 000a990 codex/agent-v2-remediation-20260824
git diff 5c9606b 857a4a2 -- .github/workflows/verify.yml studio/tests/ci-governance.test.mjs studio/tests/agent-skill-long-review.test.mjs
git ls-tree -r 5c9606b
git ls-tree -r 857a4a2
```

本报告没有枚举其他旧工作树的未提交文件或全磁盘数据，因此不作“所有本地文件均已上传”的承诺。
回滚仅需撤销本轮文档提交，不涉及运行代码或历史业务状态。
