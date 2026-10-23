# 本地确定性分镜审核

本入口只复核已通过受控本地导入登记的当前 Storyboard。它不生成或修改分镜，不批准人审，不启动素材、声音或渲染，不使用 Operator、Provider、网络或付费调用。固定上限为 **0 calls / $0**。

## 预览与执行

在 `studio/` 使用仓库锁定的 Node 版本。只读预览不签发授权、不写 Episode：

```sh
node scripts/local-storyboard-review.mjs --episode EPISODE_ID
```

预览给出当前版本、Gate hash、完整快照、已批准 Script/Research 绑定、分镜实际磁盘文件和清单、审核配置及实现指纹。核对后，执行必须提供精确预览值、实际操作者、原因和确认旗标：

```sh
node scripts/local-storyboard-review.mjs \
  --episode EPISODE_ID \
  --storyboard-version VERSION \
  --artifact-hash ARTIFACT_SHA256 \
  --snapshot SNAPSHOT_SHA256 \
  --actor human:OPERATOR \
  --reason '复核当前分镜合同，保留独立人工确认' \
  --confirm-local-storyboard-review
```

也可使用 `pnpm review:storyboard:local -- ...`。`human:OPERATOR` 是本机操作声明，不是登录会话或人审批准。部分执行参数、重复参数、未知参数，以及 Provider、数据根、预算、审核器或规则覆盖均拒绝。不会自动重取快照再执行。

## 绑定及权限边界

- 只接受 `codex-local-storyboard-import` 的当前完整登记；Storyboard 必须等待人审且 approval=pending，上游 Research/Script 必须已批准且 complete。
- 当前文件、导入清单、登记版本、Script/Research 批准和全部登记研究来源均核验实际磁盘 SHA/bytes，拒绝越界、符号链接和漂移。Script 候选或人审有变化，旧分镜不能复核。
- 快照绑定原始 Episode、审核配置及 `{version,hash}` 实现指纹。时序分镜会重新编译并比较实际 scenes、subtitles、duration、fps 与渲染合同；不根据 `implemented-contract` 旗标直接判为有效。
- 纯 cue 分镜可接受机器复核，但缺少执行/时间轴的质量问题会保留为不通过；不会把编辑稿或估时冒充已实现动画、实音对齐或视觉验收。
- 只有 `semanticReview:false` 的确定性配置可用。审核器只能拿到封闭配置，不会获得可注入语义审核或 Provider 回调。
- 每次执行只在当前进程产生随机、最长五分钟、绑定精确请求的 Capability。namespace=`local-storyboard-review/请求哈希`，operation=`review:storyboard`，scope 仅 `state.write`。授权不输出、不落盘，也不能进入任何其他副作用入口。
- Workflow Kernel 持有本期互斥锁，重新读取证据后声明持久化操作；经 CAS 写入 checking、执行机器规则、再核验文件/配置/实现与状态后提交报告。它不授予或推导五道人审。

## 结果、重放与恢复

机器 `pass` 后仍停在 Storyboard 人审；`revise` 或 `escalate` 按现有 Kernel 路由处理，不降低阈值或自动制作。正式报告只证明当前机器合同，不证明插画语义、屏幕像素、音画同步或成片质量。

成功写入报告后，同一旧快照请求不可再次提交。不要将审计尾部失败当成回滚：返回的 `commitStatus`、`audit` 和 `stateCommits` 区分报告已提交、审计待补和持久化观察器告警。必须重新读取 Episode 确认当前报告与版本，再决定后续行动。

执行出错仅在自己的 checking 检查点仍完全匹配且授权有效时恢复旧 review 状态并释放操作；若已有并发变更、CAS 冲突或授权过期，保留显式持久化操作交正常 Kernel 恢复。禁止盲目重放、篡改状态或另开宽权限入口。CLI 错误输出只包含受控错误码和通用说明，不输出任意异常正文或凭据。

停用这条 CLI 即可停用入口，既有流程及 fixed fallback 保留；不覆盖历史产物，不删除历史审核。回归使用合成内容和临时数据根，不能读取 live Episode 作为 fixture。

## 验证

```sh
node --test tests/local-storyboard-review-*.test.mjs
```

专项验证不能替代完整 `pnpm verify`、独立审查、实际画面验收及用户批准。本地测试、hosted CI、合并与发布是不同状态。
