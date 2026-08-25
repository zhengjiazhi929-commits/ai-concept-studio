# R3 回滚与恢复演练

日期：2026-08-25

适用整改：安全边界、状态并发、Provider 提交不明、素材完整性、上传事务、审计链

## 结论

当前演练实现覆盖 7 个离线场景；最终通过数和报告路径以本轮完整验证后更新的
`docs/STATUS.md` 为准。演练使用已跟踪 Fixture 和一次性临时目录，不读取或写入真实
golden-001，没有网络、模型、付费或发布调用。

这证明当前实现具备可执行的失败保护和回退路径；它不等于人工 Gate 已通过，也不
等于生产发布已批准。

## 已演练的业务风险

| 场景 | 预期保护 | 结果 |
|---|---|---|
| 过期状态写入 | CAS 冲突，保留胜者 Episode | 本地 fixture 通过 |
| 从高权限状态回到 shadow | 关闭 Main Agent / Router，取消未执行派发，保留 fixed fallback | 本地 fixture 通过 |
| Provider 成功但本地提交不明 | 只能经显式人工裁决解除冻结，不改变人工 Gate | 本地 fixture 通过 |
| 审核后素材字节变化 | 渲染开始前阻断，零渲染 | 本地 fixture 通过 |
| 并发上传与事务失败 | 不覆盖同一版本；只清理自身文件；不留孤儿 | 本地 fixture 通过 |
| 上传进程在 Episode CAS 前崩溃并重启 | 私有 staging、先写 marker；重启隔离孤儿，公开目录不残留 | 本地 fixture 通过 |
| 审计链被修改 | 读取与追加均 fail closed | 本地 fixture 通过 |

## 复现

运行环境要求 Node v24.19.0、pnpm 11.19.0：

    cd studio
    pnpm rehearse:rollback

报告写入 `outputs/studio/remediation/rollback-rehearsal-vNNN.json`，使用新版本号且不覆盖
旧报告。该目录属于本地运行证据，不进入 Git；最终报告路径、通过数和失败数记录在
`docs/STATUS.md`，本文件保存可移植的场景定义与复现命令。

## 回退顺序

1. 停止发起新 Worker 或外部调用。
2. 在动作边界把控制模式切回 shadow；系统取消尚未执行的派发并保留 fixed fallback。
3. 对 provider_result_commit_unknown 保持冻结，只有短期操作员会话、CSRF、精确
   reservation、state version 和确认语都匹配时才允许人工裁决。
4. 若素材、旁白、机器审核或状态版本漂移，作废当前审核证据，生成新版本，不覆盖旧版。
5. 若审计链无效，停止读取后的业务判断与后续追加，先由人工恢复可信账本。

## 已知边界

- 上传字节先进入不可公开访问的私有 staging；同一全局锁覆盖 staging、marker、hard-link、
  Episode CAS、提交/回滚和启动恢复。原子发布依赖 staging 与目标目录同文件系统的
  hard-link；不支持时安全失败，不写 Episode。
- 恢复把“已提交”判定绑定到 regular file、inode、bytes、SHA-256 和 Episode 元数据；
  另一个活跃事务持锁时返回 503，不与其争抢恢复。PID 被操作系统复用等极端场景仍可能
  让陈旧锁暂时保守阻塞，需要操作员检查隔离区后处理。
- 本机拥有文件系统权限的恶意进程仍可修改文件，但素材批准前和渲染前的两次摘要
  校验会阻断其进入成片。
- 本地 hash-chain 可发现普通篡改；没有外部可信锚时，不能抵御拥有整本账本重写权限
  的攻击者。
