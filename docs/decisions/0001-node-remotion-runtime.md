# ADR-0001：以 Node.js + Remotion 作为当前原型运行栈

状态：Accepted
日期：2026-08-25

## 背景

外部 SOP 示例写的是 Python，但真实仓库已经以 Node.js 实现 Workflow Kernel、HTTP 控制台、
状态和审核，以 React + Remotion 实现视频。整体切回 Python 会破坏现有行为基线，也违反
“先保护原型、逐节点替换”的原则。

## 决定

- 当前主运行时使用精确固定的 Node.js 与 pnpm。
- Remotion/React 负责可重复视频合成；业务状态和授权不放进 React 组件。
- Python 仅作为本地 Kokoro 推理工具，通过固定 JSON 请求/结果、固定解释器/依赖哈希和
  Python socket API 应用层拒绝适配，不成为 Episode 状态真源；该保护不冒充 OS 级断网。
- 直接依赖与 lockfile 固定；CI workflow 使用 frozen install 和极短本地 render smoke。
  当前已完成本地等价命令验证，但分支未 push，尚无 hosted GitHub Actions 结果。

## 结果

优点是保留已验证主路径并减少大改；代价是个别历史脚本仍有 macOS 依赖，跨平台开源前
需要逐步替换。若未来改用其他 renderer，只替换 Adapter，不改变 Episode、Gate 和 Kernel。

## 回退

回退本 ADR 需要先证明替代栈能在固定 fixture 上生成等价 Episode、MP4、QA 和恢复证据；
不能以一次 demo 成功直接整体迁移。
