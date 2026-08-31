# 长片候选的版本化分段渲染

长片候选必须从显式、版本一致的 render-job JSON 启动。历史
`render-agent-skill-long-review-wide-v004-chunked.mjs` 只保留旧 v004 恢复兼容性，不能作为新候选入口。

## 准备输入

1. 复制 `studio/config/long-review-render-job.example.json` 为新的版本文件。
2. 同时替换 `jobId`、`candidateVersion`、`episodeId`、最终目录和工作目录中的版本号。
3. Episode、旁白、入口文件必须是工作区内的普通文件；路径任一祖先不能是符号链接。
4. `protectedArtifacts` 如非空，必须记录生成前不可变旧产物的字节数和 SHA-256。
5. `temporaryVoice: true` 表示临时旁白。临时 `voice-v001` 或系统合成旁白绝不等于最终真人录音，且 `temporaryVoiceIsFinalHumanRecording` 必须为 `false`。

## 启动与续跑

从仓库根目录执行，并在脚本外部降低调度优先级：

```sh
taskpolicy -b nice -n 20 node studio/scripts/render-agent-skill-long-review-chunked.mjs \
  --job-config studio/config/render-jobs/<candidate>.json \
  --chunk-frames 900 \
  --inter-chunk-pause-ms 5000
```

固定合同为 1920x1080、30fps、18000 帧；`900` 帧一段即 20 个 30 秒分段，`concurrency=1`。片间暂停是调度参数，可以调整而不会让已验证媒体分段失效。

恢复前会重新核对源码、public 资源、Episode、旁白、Git 脏内容、Node、Chrome、Remotion/ffmpeg 工具身份，以及完整 manifest 结构。任何版本错标、manifest 篡改、符号链接越界或旧正式目录已存在都会停止，不会覆盖旧候选。

完成 20 段、逐段 ffprobe、无损拼接和音频 mux 验证后，只会在本地原子发布“审阅候选”。机器 QA 不能替代完整 1x 人工观看，也不会自动批准最终成片 Gate。

## 正式 QA 与视觉证据

新候选不能调用写死 v004 的历史命令。必须把生成该候选的同一份 render-job
显式交给通用 QA 入口：

```sh
cd studio
QA_PYTHON=/absolute/path/to/locked/python3.12 pnpm qa:long-review -- \
  --job-config studio/config/render-jobs/<candidate>.json \
  --qa-dir-name qa
```

`--job-config` 路径相对仓库根目录。入口不接受另行指定 candidate 目录或 MP4：
job 中的 `candidateVersion`、`episodeId`、`finalDirectory` 和固定的
`review-10m.mp4` 必须与候选 `review-manifest.json` 的通用 schema、render contract、
最终媒体 bytes/SHA-256 和发布路径逐项一致。job、候选目录、MP4、manifest 及其路径祖先
都必须是工作区内的普通非符号链接对象；任一不一致、来源在 QA 期间变化或目标 `qa/`
已经存在都会 fail closed，且不会覆盖历史证据。

通用 QA 还要求候选目录存在与 MP4、manifest 和 render-job 精确绑定的正向 durable
receipt；`durability_unknown` 不能进入 QA，必须先在原目录就地复核并确认，不能通过重渲染、
改名或覆盖来绕过发布耐久性边界。

正式入口会完整解码媒体，生成 18 个场景的代表帧、17 个边界的多偏移帧、每 2 秒
周期采样、自动候选指标、QA 报告和联系表。报告明确保持
`pending_manual_visual_review`：机器检查只证明媒体和证据生成过程，没有证明构图、文字、
节奏或转场已经被人工接受。必须继续打开实际 MP4 做连续 1x 观看并由人工确认。

历史 `qa-agent-skill-long-review-wide-v004.mjs` 只保留 v004 恢复兼容；v005 及以后
一律使用 `pnpm qa:long-review -- --job-config ...`。
