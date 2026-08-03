# 本地 SaaS 真实采集证据

- 采集日期：2026-08-03
- 项目：`demo/agentic-coding-saas`
- 数据：全部为程序生成的虚构客户数据
- 网络：未访问外部网络
- baseline：`d3ef196`
- fixed：`c619b0c`
- final：`e717f5f`

## Before

baseline 的验收测试为 5 项中 1 项通过、4 项失败。浏览器真实点击导出后：

```json
{
  "responseStatus": 200,
  "responseContentType": "text/csv; charset=utf-8",
  "pageState": "失败"
}
```

原因：旧后端同步返回 CSV，而前端把响应当作异步任务 JSON 解析。此状态不是后期动画。

对应画面：

- `screen-selects/demo-baseline-before-click.png`
- `screen-selects/demo-baseline-export-failed.png`

优先承接分镜：22、23、24、36。

## After

fixed 的验收测试为 5 项全部通过。独立 HTTP 冒烟验收：

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

对应画面：

- `screen-selects/demo-final-before-export.png`
- `screen-selects/demo-viewer-denied.png`
- `screen-selects/demo-admin-export-complete.png`

优先承接分镜：33、40、66、67、83。

## 采集与真实性说明

- Before 从 Git `baseline` 标签的独立 worktree 启动；
- After 从 `fixed` 实现启动；
- 截图由本机无界面浏览器访问实际运行页面生成；
- 点击、角色切换、HTTP 状态、后台任务轮询和下载入口均来自真实页面行为；
- 第一版修复已经 5/5 通过，因此不人为制造第二轮失败；
- 页面中的完整邮箱和手机号只属于虚构数据，最终下载内容已按验收规则脱敏；
- 原始图片未叠加结论文字，后续只允许裁切、推近、框选和来源角标。
