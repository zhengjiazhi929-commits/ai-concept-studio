# 零付费本地 Research 入口

## 用途与授权边界

`studio/scripts/local-research.mjs` 为已存在的 Episode 提供两种固定操作：

- `run`：通过现有研究 Worker、Kernel 和机器审核路径核查公开资料，生成或更新研究产物。
- `import`：导入已阅读、已核验的一手来源与主张，绑定候选文件哈希、批次 ID 和当前 Episode 快照。

入口只服务本地明确授权的研究流程。它不是远程登录、通用管理员接口，也不代表人工批准
Research Gate。研究、脚本、分镜、素材/声音和最终成片的五道人审保持独立。
用户已明确授权某一期的本地研究系列操作时，不必每个工具调用重复请求许可；执行仍须
先取得当前预览，再把当前版本、快照和对应的实际授权声明交给入口。内容、任务或范围发生
变化时应重新核对，不能把过期快照的声明机械替换成新的哈希。

每次执行使用随机、仅进程内存中的五分钟 Capability，固定 `maxCalls=0`、`maxCostUsd=0`。
不读取发现任务身份文件，不启动 HTTP 服务，不提供预算、Provider、operation、scope、
数据根目录或自定义授权器参数。`run` 可以免费核查公开 HTTPS 资料，但不能调用付费模型。
外部抓取不等于事实已核验；证据批次仍须明确主张、来源、定位和适用边界。

底层 sink 同样拒绝非零预算及额外权限，不仅依赖 CLI 参数限制。`run` 必须由 Kernel
在持有任务锁、检查精确输入后发出单次进程内派发令牌；有效 Capability 本身不足以直接
调用底层研究函数。令牌绑定完整运行输入、请求与授权，不能伪造、替换输入或重用。

现有 `run-research.mjs`、`import-research-evidence.mjs` 未被改成自动授权入口。
缺少其所需 Capability 时继续失败关闭，不得通过测试依赖注入绕过生产授权。

## 预览与执行

在 `studio/` 中使用仓库锁定的 Node 版本。以下占位值必须替换为真实预览返回值；
示例不是可重用的授权，也不应当作为测试 Fixture 运行到真实 Episode。

只读运行预览：

```sh
node scripts/local-research.mjs --episode '目标episode-id' --action run
```

执行同一快照的研究操作；新一期首次运行的研究版本通常是 `0`，以实际预览为准：

```sh
node scripts/local-research.mjs \
  --episode '目标episode-id' --action run \
  --research-version '0' --snapshot '预览返回的64位snapshotHash' \
  --actor 'human:实际授权人' --reason '对本次研究操作的实际授权说明' \
  --confirm-local-research
```

导入前先预览候选文件：

候选路径必须是仓库相对路径，位于 `outputs/` 或 `studio/data/research/inbox/` 下，
并以 `.json` 结尾。禁止绝对路径、`..`、反斜杠、查询串或片段；CLI 测试里的示例路径
只是一段合成字符串，不读取该路径。

```sh
node scripts/local-research.mjs \
  --episode '目标episode-id' --action import \
  --candidate 'outputs/本期证据/候选证据.json'
```

执行必须额外绑定候选批次和文件 SHA-256：

```sh
node scripts/local-research.mjs \
  --episode '目标episode-id' --action import \
  --candidate 'outputs/本期证据/候选证据.json' \
  --research-version '当前预览中的研究版本' --snapshot '预览返回的64位snapshotHash' \
  --batch-id '候选文件中的batch-id' --candidate-sha256 '预览返回的64位文件哈希' \
  --actor 'human:实际授权人' --reason '对导入已核验研究证据的实际授权说明' \
  --confirm-local-research
```

只有 `--episode`、`--action`，以及 import 必需的 `--candidate` 时，是只读预览。
一旦提供任一执行参数，就必须提供完整执行声明；不完整参数不会退化为执行。
`run` 禁止接收 `--candidate`、`--batch-id` 和 `--candidate-sha256`，这些字段内部固定为空。
重复参数、未知参数、非法版本、缺失确认都会在进入生产操作前拒绝。

## 版本、恢复与人审

- 快照绑定 Episode、当前研究版本及对应输入；文件变更或并发写入必须重新预览，不能自动重试旧声明。
- Kernel交接后，在实际HTTP请求和产物/状态写入前重新核验研究配置、零费用审核配置与已登记研究包的实际SHA/bytes；
  导入同时核验候选文件。相同Episode ID不代表文件未变，预览通过不能替代消费时完整性校验。
- 同一批次的内容不得修改后复用 ID。导入采用现有不可覆盖产物、Episode CAS 和幂等审计机制。
- 成功退出只说明入口返回成功。应检查结果中的状态、publication/audit 警告和机器审核结果；
  不把 `readyForFactApproval` 当作人审通过，也不把机器检查通过当成视频验收。
- 如果导入已提交但派生指针或审计发布有警告，应按已有恢复机制处理，不删除已提交产物、
  改用新批次或重建 Episode 来规避冲突。
- 导入 CAS 已成功后若授权过期，返回 `committed_with_warning`，不会误报全部失败；
  对相同文件和批次重新预览并授权，可补发指针/审计，不重复增加研究版本。
- 运行中授权过期会阻止后续抓取和写入，可能留下 `running` 标记。先按现有 Kernel
  中断恢复流程核对真源，再决定新预览；不能删除状态或自动重跑来绕过恢复。
- 后续研究 Worker 可能重新抓取并生成新产物版本；研究审批仍绑定最终实际展示的版本和哈希。
- 本入口不创建选题、不创建 Episode、不运行脚本/分镜/声音/渲染、不提交 Git，也不批准任何 Gate。

## 验证和停用

CLI 测试使用合成请求与 stub 生产入口，但接收真实短期 Capability，检查零费用、
请求绑定、跨任务拒绝、过期、非目标 sink 拒绝和错误脱敏，不读取 live Episode。
这不能替代生产 wrapper、临时数据根 Kernel/CAS、并发恢复和全量测试。

```sh
node --test tests/local-research-cli.test.mjs
```

CLI 错误输出只保留已知代码与固定说明，不回传原始异常、候选正文或身份内容。
若需要停用，停止使用新增本地 CLI 即可；旧失败关闭入口和 fixed fallback 不变。
不得为回退删除研究产物、批次、历史或审计记录。最新完成状态以 `docs/STATUS.md` 为准。
