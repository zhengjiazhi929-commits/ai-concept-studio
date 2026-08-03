# Final 测试记录

- 日期：2026-08-03
- baseline：`d3ef196` / 标签 `baseline`
- fixed：`c619b0c` / 标签 `first-pass`、`fixed`
- 验收测试：5 项通过，0 项失败
- 既有验收测试未被修改
- `git diff --check`：通过

## 验收测试结果

1. 客户列表使用本地虚构数据：通过；
2. 普通用户不能创建导出任务：通过；
3. 管理员立即收到 `202`、任务编号和后台状态：通过；
4. 任务完成后可下载脱敏 CSV：通过；
5. 普通用户不能查询或下载管理员导出结果：通过。

## 独立 HTTP 冒烟验收

```json
{
  "pageStatus": 200,
  "viewerStatus": 403,
  "createStatus": 202,
  "finalState": "complete",
  "downloadStatus": 200,
  "sensitiveFieldsMasked": true
}
```

## 已知限制

- 导出任务和 CSV 仅存在于当前进程内存中，服务重启后丢失；
- `role` 查询参数只用于本地演示，不是生产鉴权；
- 后台任务仍在当前 Node.js 进程内执行；生产大规模任务需要持久化队列和独立工作进程。
