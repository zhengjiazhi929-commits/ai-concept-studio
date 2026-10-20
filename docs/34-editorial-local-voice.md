# Editorial 本地完整旁白与实测字幕

状态：2026-09-17 技术完成。v002完整旁白716.39秒及172条实测字幕已登记，state35→36；全量1532/1532+verify exit0。等待用户试听，不代表素材/声音Gate通过，未音画集成、未渲染、未Git发布。当前证据见STATUS.md v59与outputs/context-memory-full-voice-20260917/v002/；27处超时的局部重合成机制见doc35。

## DoR 与用户授权

Zhengjiazhi 已选中 zm_010 略快试听（合成 speed=1.1），随后对“按这个声音制作完整旁白，并补齐配音登记和字幕校时流程；仅本地、零付费，暂不渲染视频”回答“是”。本轮实施与执行范围到完整声音文件、实测字幕候选和受控登记为止，不批准素材/声音 Gate、渲染、Git 发布或模型/依赖下载。

- 风险 R3：跨模块生产文件登记、Capability 与 CAS；不扩大普通 Worker 权限。
- 真实源：当前迁移目录；HEAD 0c2b1cdc993a8c9492ab5a091573d673ac60503d，codex/topic-discovery-workflow-20260909，已有 dirty 保留。
- 隔离开发：独立普通 Git clone，加当前源码快照和独立 node_modules 副本；不复制 5 项 live collector/trend 修改，不把本期素材或音频当测试 fixture。
- 不改旧 60 秒 TTS 入口、不改已批脚本/分镜、不改 review-rubrics、不改视觉实现/package/lock、不覆盖旧素材 bundle。不使用通用上传把合成旁白伪装为人工录音。

## 行为与验收

1. 以已批准 hook、正文、closing 与 24 镜/46 原文段落为唯一文本来源。按完整语义标点和闭引号边界切分，不漏字、重复或跨原文段落，不按目标时长调速。
2. 单个字幕短句生成独立 PCM，合成前验证音素未知字符、词表与 510 长度限制。AI/Agent/RAG/A/B 从本地锁定词典取读音，遇其他英语失败而不下载。沿用选择音色、模型与 speed=1.1。
3. 每条字幕起止由真实生成 PCM 样本位置确定，输出 Remotion Caption JSON 与 SRT、scene/unit 时间区间。标记 alignmentMethod=synthesis-segment-sample-boundaries-v1；是短句片段边界，不伪称逐字 forced alignment。字级置信度留 null，不用估算字数分配时间。
4. 新增独立不可变 production.editorialVoice 收据及新 voice mode=editorial-local-tts。保留 episode.scenes/subtitles/render.duration 和原 editorialMaterialization 不动，实测时轴独立保存；captionAligned=true 不意味着 motionAligned/renderReady=true。
5. 注册默认只读 preview，执行需要精确候选/快照/实现哈希及 human actor/reason/confirm。所有源文件、音频与字幕逐项校验，拒绝路径逃逸/符号链接；专用纯 Kernel transition + 单 CAS，assets/final 审批失效并保持 pending，不发起自动人审。
6. 同请求重试只确认既有提交并补审计，不能重新合成、覆盖输出或重置后续状态；CAS 前失败保留未登记候选，CAS 后审计失败明确 committed_with_warning。
7. 本地模型/音色/runtime/词典和实现 SHA 绑定，Python 层断网和离线环境、固定执行超时；不宣称 OS 沙箱。0 外部 API/0 美元，内部试听/审查产物，不自动获得发布许可。

## 测试与回退

- 先用临时合成 fixture 验证切分/原文覆盖、音素和 PCM 边界、字幕样本/时间/文本、包完整性、路径/符号链接、能力不足、来源变化、CAS 竞争、幂等与审计恢复。
- 聚焦测试后，在独立 clone 运行完整 verify。禁止测试读取 live Episode 或个人输出；真实制作只在实现验证和代码审查之后执行。
- 回退为停用新增入口并保留已写候选/收据，不删除旧素材、不恢复旧审批、不手改 Episode。正式 renderer 继续拒绝尚未完成动画音频集成的版本。
- 本轮完成时分别报告：代码验证、完整声音/字幕文件、受控登记、尚待声音与视觉验收，以及没有渲染/发布。
