# 本地旁白局部重合成（2026-09-17）

## 当前事实与范围

v1 实现已经冻结、1503/1503+完整 verify exit0 后24文件同步到实际源。已选zm_010/speed1.1本地生成145段，685.115秒，0API/$0，Episode仍state35，未登记/未渲染。27段实测超过字幕5.5秒规则，0短于.75秒。不得伪造字幕、拉伸声音、改语速、覆盖已有候选或把这些失败直接放行为合格。

继续用户已授权的“完整旁白与配音登记、字幕校时”，只扩充必要局部重合成入口。原文/voice/speed/模型不变，不新批准Gate、不渲染、不Git发布。保留不可变v1原音频；复用118个合格父段原字节，只对27个超长父段按语义原标点拆分、真实生成子段并拼回父段。四条只有顿号的列表逐条制定边界；禁止全局按字数硬切。子文本严格拼回父原文，不增删字符或标点。

## 固定设计

- v1 timing/driver原文件尽量保持不改，避免令已生成base的driver pins失效。另增 shared/editorial-voice-retakes.mjs：纯 repair plan验证与实测子段timeline，父plan保持145个原身份，子句PCM样本构成caption。没有真实子PCM不得凭字符分配时码。
- repair plan是显式本地JSON候选，绑定baseCandidatePath+baseCandidateSha256及27个父id的parts；精确覆盖base timing里的outliers，非outlier不得重合成。各parts文本有textSha256，拼接等于base文本，至少2段，长度/语义边界安全且不能拆英文token。保留父末尾的paragraph/scene gap，仅最后一个子段后加，其他子段gap=0。
- 新scripts/retake-editorial-local-voice.py执行固定本地zm_010/1.1：导入v1 driver作为可复用纯验证与PCM写入工具，仍核对全部实际载入路径/模型/runtime/词典/新driver自身。只为修复parts调用底层synthesize；非修复父WAV exclusive复制原字节（hash一致），修复父WAV等于子段PCM原字节拼接。最后full WAV=所有父WAV+旧父gap。0下载/API，stdout逐父进度，保留完整result与manifest。
- 新候选schema editorial-local-voice-retake-candidate-v1。基本manifest字段与v1相同，增加baseCandidate:{path,sha256}、repairPlan:{path,sha256,bytes}；files精确包括base引用证据、retake请求/driver请求、执行结果、145父WAV、修复parts WAV、完整WAV、timing/captions/srt。不覆盖原v1。
- 生产新入口scripts/retake-editorial-voice.mjs默认只读preview，执行绑定snapshot/request/implementation/repair plan与confirm；Capability独立namespace editorial-voice-retake/<hash>，operation voice:retake-editorial，只filesystem.write/local-inference、0calls/$0，spawn前及每次写后续文件前复验。注册仍使用现有严格register入口和单CAS，不放宽5.5秒质量条件。
- 读取v1 base必须重验source/完整file-set/PCM/文本/真实样本timing/原driver pins，但允许其已如实记录的durationIssues，且历史implementationHash只作为历史标识，不宣称等于新实现。传入expected历史hash来自被新授权request绑定的base manifest SHA；新candidate必须绑定当前新实现hash。当前源稿/分镜/原视觉bundle始终重验。
- 新timing独立schema editorial-voice-retake-timing-v1，alignmentMethod仍为synthesis-segment-sample-boundaries-v1；父总samples按子总samples重算，captions来自实际子samples。保留scenes/units原身份和正确gap，captionDurationIssues为空才可严格登记。

## 验证

先 RED→GREEN synthetic tests，不用本期作为fixture。覆盖保原文、只修复outlier、子片段PCM拼接、原父复用hash、修复请求字节、路径/symlink、capability失效、重复目录、源漂移。独立代码审查后刷新控制实现v13，freeze全verify再同步delta。生成retake后完整ffmpeg解码及候选严格验证，再登记。若仍有真正超限则继续保留未合格候选，不自动绕过。

v1音频独立检查：145父PCM及完整WAV哈希、声明间隔拼接、Caption/SRT/timing重算均一致，ffmpeg完整解码exit0；没有削波。静音探测约24.53%仅是信号统计，不能替代听感。新输出仍须重测、由用户试听确认，不宣称已经自然流畅。27处原标点拆分已逐条核对，四条枚举在完整短语后的顿号分隔；原文逐字保留，实际输出目录v002保留显式修复输入和审核记录，不纳入测试fixture。

独立审查发现并RED→GREEN修复了基线复用音频的竞态：验过base后它的WAV可能变化，不能只把new WAV和“此刻读到的base WAV”互相比。现在复用PCM必须匹配已验证base.result的SHA/bytes/samples，末尾再次核验完整base file-set；base manifest双次读取的SHA也必须持续等于请求绑定。相应synthetic integrity测试13/13，含恶意重hash的复用PCM、子PCM拼接和字幕时间戳，不把自洽哈希当原始真实性。
