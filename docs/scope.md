# 当前范围与非目标

更新时间：2026-08-25

## 本轮范围

- 修复安全第二批：SSRF/DNS rebinding、静态路径、脱敏、审计完整性。
- 修复恢复闭环：Provider 提交不明、素材/旁白 TOCTOU、上传竞争和孤儿文件。
- 固定运行时并建立 CI：frozen install、语法、全量测试、依赖高危和本地 render smoke。
- 将 Script、Storyboard、Asset Worker 提示词独立版本化并纳入评测绑定。
- 建立签名评测与 append-only 证据存储基础设施，但保持 release admission 关闭。
- 补齐阶段 0、安全、架构、PRD、范围、ADR、回滚与状态文档。
- 先核验 golden-001 已批准的研究、脚本和分镜是否仍精确绑定当前内容；发现失配时
  立即停在对应人工 Gate，不沿用历史批准。
- 当前研究、36 秒短脚本和六镜分镜依次重新批准后，使用本地 Kokoro 生成仅供内部试听的旁白候选，
  再在素材/声音 Gate 停止；长版 `07-script.md` / `08-storyboard.md` 只保留为参考来源。
- 人工素材/声音 Gate 通过后，才生成本地 Remotion MP4、执行 QA 并停在最终 Gate。

## 明确非目标

- 不调用付费或外部模型、语音、图片、视频、发布 API。
- 不全网抓取，不绕过登录、验证码、付费墙、robots 或站点访问控制。
- 不自动批准任何 Gate，不模拟 Zhengjiazhi 的人工决定。
- 不把签名评测基础设施当作真实 shadow 或高权限准入证据。
- 不启用 assisted / active，不关闭 fixed fallback。
- 不合并 main、不 push、不部署、不发布、不创建版本标签。
- 不为假设中的多用户 Web 产品提前引入队列、租户、计费或云存储。
- 不批量删除历史脚本、proof、handoff 或媒体；删除候选需要独立审查。
- 不替项目负责人选择开源许可证或授权第三方内容。
- 不把 Python 进程内的 socket API 拒绝描述为操作系统级断网证明；本轮不提供全机流量
  取证，旁白 manifest 只陈述项目生成路径中已配置和执行的外部调用数。

## 变更边界

每项变更必须使用 tracked fixture 或临时目录验证。真实 golden-001 只在获得对应人工
决定后进入下一个生产阶段；测试不能读取或修改它来制造通过结果。

当前分支只承载整改，最终是否合并 main 由 Zhengjiazhi 在业务验收后另行决定。

CI 边界：workflow 与本地等价命令已在当前分支定义并完成本地验证；截至本状态记录，分支
尚未 push，因此没有 hosted GitHub Actions 运行结果。“本地门禁通过”不等于“云端 CI 已通过”。
