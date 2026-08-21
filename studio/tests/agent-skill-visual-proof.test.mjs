import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { studioRoot } from "../src/shared/paths.mjs";
import {
  VISUAL_PROOF_CHAPTER_WEIGHTS,
  VISUAL_PROOF_DURATION_SECONDS,
  VISUAL_PROOF_FPS,
  VISUAL_PROOF_SHOTS,
  VISUAL_PROOF_SUBTITLES,
  nextVisualProofVersion,
  visualProofProgressAt,
  visualProofShotAt,
  visualProofSubtitleAt
} from "../src/video/agent-skill-visual-proof-plan.mjs";
import {
  NATURAL_VOICE_NAME,
  NATURAL_VOICE_PROOF_DURATION_SECONDS,
  NATURAL_VOICE_SEGMENTS,
  naturalVoiceSubtitleAt,
  nextNaturalVoiceProofVersion
} from "../src/video/agent-skill-natural-voice-plan.mjs";
import {
  LOCAL_TTS_DEFAULT_VOICE,
  LOCAL_TTS_MODEL,
  LOCAL_TTS_PROOF_DURATION_SECONDS,
  LOCAL_TTS_SAMPLE_RATE,
  LOCAL_TTS_SEGMENTS,
  LOCAL_TTS_SUBTITLES,
  LOCAL_TTS_VOICES,
  localTtsSpokenTextAt,
  localTtsSubtitleAt,
  nextLocalTtsProofVersion,
  nextLocalTtsScreenVersion
} from "../src/video/agent-skill-local-tts-plan.mjs";
import {
  VISUAL_PROOF_MOTION_PHASES,
  motionPhaseAt,
  motionPhaseIndex
} from "../src/video/agent-skill-motion-plan.mjs";

test("60 秒视觉样片由六种短动态镜头连续覆盖，不回退成长时间文字卡", () => {
  assert.equal(VISUAL_PROOF_DURATION_SECONDS, 60);
  assert.equal(VISUAL_PROOF_FPS, 30);
  assert.equal(VISUAL_PROOF_SHOTS.length, 6);
  assert.equal(VISUAL_PROOF_SHOTS[0].start, 0);
  assert.equal(VISUAL_PROOF_SHOTS.at(-1).end, 60);
  assert.equal(new Set(VISUAL_PROOF_SHOTS.map((shot) => shot.kind)).size, 6);
  for (const [index, shot] of VISUAL_PROOF_SHOTS.entries()) {
    assert.ok(shot.end - shot.start <= 12);
    if (index > 0) assert.equal(shot.start, VISUAL_PROOF_SHOTS[index - 1].end);
  }
  assert.equal(visualProofShotAt(0).id, "hook");
  assert.equal(visualProofShotAt(59.9).id, "team-example");
  assert.deepEqual(VISUAL_PROOF_SHOTS.map((shot) => shot.chapter), [
    "判断", "重复", "整理", "合并", "调用", "共建"
  ]);
  assert.deepEqual(VISUAL_PROOF_CHAPTER_WEIGHTS, [8, 10, 12, 12, 10, 8]);
  assert.equal(
    VISUAL_PROOF_CHAPTER_WEIGHTS.reduce((total, duration) => total + duration, 0),
    VISUAL_PROOF_DURATION_SECONDS
  );
  assert.equal(visualProofProgressAt(-1), 0);
  assert.equal(visualProofProgressAt(30), 0.5);
  assert.equal(visualProofProgressAt(60), 1);
  assert.equal(visualProofProgressAt(Number.NaN), 0);
});

test("六个镜头都把内容动作均匀分成前中后三阶段，避免入场后长期静止", async () => {
  const component = await readFile(
    resolve(studioRoot, "src", "video", "agent-skill-visual-proof.jsx"),
    "utf8"
  );
  assert.deepEqual(Object.keys(VISUAL_PROOF_MOTION_PHASES), VISUAL_PROOF_SHOTS.map((shot) => shot.id));
  for (const shot of VISUAL_PROOF_SHOTS) {
    const durationInFrames = (shot.end - shot.start) * VISUAL_PROOF_FPS;
    assert.equal(motionPhaseIndex(durationInFrames * 0.1, durationInFrames), 0);
    assert.equal(motionPhaseIndex(durationInFrames * 0.5, durationInFrames), 1);
    assert.equal(motionPhaseIndex(durationInFrames * 0.9, durationInFrames), 2);
    assert.notEqual(motionPhaseAt(shot.id, durationInFrames * 0.1, durationInFrames), "unknown");
    assert.notEqual(motionPhaseAt(shot.id, durationInFrames * 0.9, durationInFrames), "unknown");
  }
  assert.ok((component.match(/motionPhaseIndex\(frame, durationInFrames\)/gu) ?? []).length >= 6);
  assert.match(component, /folderRowDelay/u);
  assert.match(component, /contributorDelays/u);
  assert.match(component, /stagedProgress/u);
});

test("样片沿用已批准旁白的前 60 秒字幕并裁切在样片边界", () => {
  assert.equal(VISUAL_PROOF_SUBTITLES[0].start, 0);
  assert.equal(VISUAL_PROOF_SUBTITLES.at(-1).end, 60);
  assert.match(visualProofSubtitleAt(10), /提示词/u);
  assert.match(visualProofSubtitleAt(55), /竞品分析/u);
});

test("样片 Composition 使用代码动画和既有旁白，不引用五张静态文字卡", async () => {
  const [component, root, renderer] = await Promise.all([
    readFile(resolve(studioRoot, "src", "video", "agent-skill-visual-proof.jsx"), "utf8"),
    readFile(resolve(studioRoot, "src", "video", "root.jsx"), "utf8"),
    readFile(resolve(studioRoot, "scripts", "render-agent-skill-visual-proof.mjs"), "utf8")
  ]);
  assert.match(root, /id="AgentSkillVisualProof"/u);
  for (const componentName of [
    "HookScene",
    "PromptRepeatScene",
    "PromptToSkillScene",
    "KnowledgeMergeScene",
    "SkillDiscoveryScene",
    "TeamExampleScene"
  ]) {
    assert.match(component, new RegExp(`function ${componentName}\\b`, "u"));
  }
  const sceneList = component.match(/const sceneComponents = \[([\s\S]*?)\];/u)?.[1] ?? "";
  assert.deepEqual(
    [...sceneList.matchAll(/\b([A-Z][A-Za-z]+Scene)\b/gu)].map((match) => match[1]),
    [
      "HookScene",
      "PromptRepeatScene",
      "PromptToSkillScene",
      "KnowledgeMergeScene",
      "SkillDiscoveryScene",
      "TeamExampleScene"
    ]
  );
  assert.match(component, /APPROVED_VISUAL_PROOF_AUDIO/u);
  assert.match(component, /voice-v001\.wav/u);
  assert.doesNotMatch(component, /material-v00[1-5]\.png/u);
  assert.match(renderer, /paidApiCalls:\s*0/u);
  assert.match(renderer, /generatedImageCalls:\s*0/u);
  assert.match(renderer, /generatedVideoCalls:\s*0/u);
});

test("选定的 zm_010 使用独立 Composition、无底板字幕和版本化审核视频", async () => {
  const [component, root, renderer] = await Promise.all([
    readFile(resolve(studioRoot, "src", "video", "agent-skill-visual-proof.jsx"), "utf8"),
    readFile(resolve(studioRoot, "src", "video", "root.jsx"), "utf8"),
    readFile(resolve(studioRoot, "scripts", "render-agent-skill-visual-proof.mjs"), "utf8")
  ]);
  assert.match(root, /id="AgentSkillLocalTtsVisualProof"/u);
  assert.match(root, /subtitleTrack: "local-tts-zm-010"/u);
  assert.match(component, /local-tts-proof-v002\.wav/u);
  assert.match(component, /localTtsSubtitleAt/u);
  assert.match(component, /bottom=\{82\}/u);
  assert.match(component, /horizontalInset=\{12\}/u);
  assert.match(component, /fontSize=\{21\}/u);
  assert.match(component, /lineHeight=\{1\.28\}/u);
  assert.match(renderer, /const compositionId = "AgentSkillLocalTtsVisualProof"/u);
  assert.match(renderer, /COPYFILE_EXCL/u);
  assert.match(renderer, /voiceProofManifest\.voice !== "zm_010"/u);
  assert.match(renderer, /externalInferenceCalls:\s*0/u);
  assert.match(renderer, /textUploadCalls:\s*0/u);
  assert.doesNotMatch(renderer, /writeEpisode|saveVoiceUpload/u);
});

test("重复输入场景不把视觉隐喻伪装成再次粘贴字段或系统快捷键浮窗", async () => {
  const [component, renderer] = await Promise.all([
    readFile(resolve(studioRoot, "src", "video", "agent-skill-visual-proof.jsx"), "utf8"),
    readFile(resolve(studioRoot, "scripts", "render-agent-skill-visual-proof.mjs"), "utf8")
  ]);
  assert.doesNotMatch(component, /再次粘贴/u);
  assert.doesNotMatch(component, /pasteY/u);
  assert.doesNotMatch(component, />\s*⌘V\s*</u);
  assert.match(component, /<ChatWindow person="甲"/u);
  assert.match(component, /<ChatWindow person="乙"/u);
  assert.match(component, /<ChatWindow person="丙"/u);
  assert.match(component, /重复输入 × 3/u);
  assert.match(renderer, /sourceRenderVersion:\s*15/u);
});

test("六阶段按镜头时长划分平直矩形进度条，文字同级且移除右上角计数", async () => {
  const [component, renderer] = await Promise.all([
    readFile(resolve(studioRoot, "src", "video", "agent-skill-visual-proof.jsx"), "utf8"),
    readFile(resolve(studioRoot, "scripts", "render-agent-skill-visual-proof.mjs"), "utf8")
  ]);
  const progressStart = component.indexOf("function ChapterProgress");
  const progressEnd = component.indexOf("export function AgentSkillVisualProof", progressStart);
  assert.ok(progressStart > 0 && progressEnd > progressStart);
  const progressComponent = component.slice(progressStart, progressEnd);
  const backdropStart = component.indexOf("function Backdrop");
  const backdropEnd = component.indexOf("function SceneCanvas", backdropStart);
  assert.ok(backdropStart > 0 && backdropEnd > backdropStart);
  const backdropComponent = component.slice(backdropStart, backdropEnd);
  assert.match(progressComponent, /visualProofProgressAt\(currentSecond\)/u);
  assert.match(progressComponent, /Math\.round\(progress \* CHAPTER_PROGRESS_WIDTH\)/u);
  assert.match(progressComponent, /left:\s*0/u);
  assert.match(progressComponent, /right:\s*0/u);
  assert.match(progressComponent, /bottom:\s*0/u);
  assert.match(progressComponent, /height:\s*36/u);
  assert.match(progressComponent, /width:\s*progressPixels/u);
  assert.match(progressComponent, /backgroundColor:\s*"rgba\(239, 242, 239, 0\.30\)"/u);
  assert.match(progressComponent, /backgroundColor:\s*"rgba\(128, 139, 133, 0\.18\)"/u);
  assert.doesNotMatch(progressComponent, /borderRadius|boxShadow/u);
  assert.match(progressComponent, /gridTemplateColumns:\s*CHAPTER_PROGRESS_GRID/u);
  assert.match(component, /const CHAPTER_PROGRESS_GRID = VISUAL_PROOF_CHAPTER_WEIGHTS/u);
  assert.match(component, /\.map\(\(duration\) => `\$\{duration\}fr`\)/u);
  assert.doesNotMatch(progressComponent, /repeat\(/u);
  assert.match(progressComponent, /borderLeft/u);
  assert.doesNotMatch(progressComponent, /shotIndex/u);
  assert.doesNotMatch(progressComponent, /transparent/u);
  assert.doesNotMatch(progressComponent, /LIQUID_GLASS|透镜/u);
  assert.doesNotMatch(progressComponent, /backdropFilter|WebkitBackdropFilter/u);
  assert.doesNotMatch(progressComponent, /linear-gradient|radial-gradient|calc\(/u);
  assert.doesNotMatch(component, /height:\s*4,\s*borderRadius:\s*4/u);
  assert.doesNotMatch(backdropComponent, /shotIndex|padStart/u);
  assert.doesNotMatch(component, /visualProofShotAt|<Backdrop shotIndex=/u);
  assert.match(component, /<Backdrop \/>/u);
  assert.match(component, /<ChapterProgress currentSecond=\{currentSecond\} \/>/u);
  assert.match(renderer, /const flickerFrames = \[1018, 1019, 1020, 1021, 1022\]/u);
  assert.match(renderer, /sourceRenderVersion:\s*15/u);
});

test("样片字幕使用无底板描边样式，同时保留通用字幕的默认底板", async () => {
  const [component, chrome] = await Promise.all([
    readFile(resolve(studioRoot, "src", "video", "agent-skill-visual-proof.jsx"), "utf8"),
    readFile(resolve(studioRoot, "src", "video", "components", "chrome.jsx"), "utf8")
  ]);
  assert.match(component, /variant="outline"/u);
  assert.match(component, /bottom=\{82\}/u);
  assert.match(component, /horizontalInset=\{12\}/u);
  assert.match(component, /fontSize=\{21\}/u);
  assert.match(component, /lineHeight=\{1\.28\}/u);
  assert.match(chrome, /variant = "panel"/u);
  assert.match(chrome, /bottom = 72/u);
  assert.match(chrome, /horizontalInset/u);
  assert.match(chrome, /const inset = horizontalInset/u);
  assert.match(chrome, /backgroundColor: isOutline \? "transparent" : colors\.ink/u);
  assert.match(chrome, /WebkitTextStroke: isOutline/u);
});

test("自然男声试听按六个画面段落连续覆盖并使用口语化短句", () => {
  assert.equal(NATURAL_VOICE_PROOF_DURATION_SECONDS, 60);
  assert.match(NATURAL_VOICE_NAME, /^Reed/u);
  assert.equal(NATURAL_VOICE_SEGMENTS.length, VISUAL_PROOF_SHOTS.length);
  for (const [index, segment] of NATURAL_VOICE_SEGMENTS.entries()) {
    assert.equal(segment.start, VISUAL_PROOF_SHOTS[index].start);
    assert.equal(segment.end, VISUAL_PROOF_SHOTS[index].end);
    assert.ok(segment.rate >= 170 && segment.rate <= 190);
  }
  assert.match(naturalVoiceSubtitleAt(1), /你有没有遇到/u);
  assert.match(naturalVoiceSubtitleAt(56), /三位同事/u);
});

test("自然声音试听独立版本化且不替换 Episode 已批准旁白", async () => {
  const builder = await readFile(
    resolve(studioRoot, "scripts", "build-agent-skill-natural-voice-proof.mjs"),
    "utf8"
  );
  assert.match(builder, /paidApiCalls:\s*0/u);
  assert.match(builder, /externalNetworkCalls:\s*0/u);
  assert.doesNotMatch(builder, /writeEpisode|saveVoiceUpload/u);
  assert.equal(nextNaturalVoiceProofVersion([]), 1);
  assert.equal(nextNaturalVoiceProofVersion(["natural-voice-proof-v001.wav"]), 2);
  assert.equal(nextNaturalVoiceProofVersion(["natural-voice-proof-v002-manifest.json"]), 3);
});

test("本地开源中文男声固定模型版本和文件哈希，六段口播与画面时槽对齐", () => {
  assert.equal(LOCAL_TTS_PROOF_DURATION_SECONDS, 60);
  assert.equal(LOCAL_TTS_SAMPLE_RATE, 24000);
  assert.equal(LOCAL_TTS_MODEL.repoId, "hexgrad/Kokoro-82M-v1.1-zh");
  assert.match(LOCAL_TTS_MODEL.revision, /^[a-f0-9]{40}$/u);
  assert.match(LOCAL_TTS_MODEL.sha256, /^[a-f0-9]{64}$/u);
  assert.match(LOCAL_TTS_MODEL.configSha256, /^[a-f0-9]{64}$/u);
  assert.equal(LOCAL_TTS_DEFAULT_VOICE, "zm_010");
  assert.deepEqual(LOCAL_TTS_VOICES.map((voice) => voice.id), [
    "zm_010", "zm_020", "zm_045", "zm_061"
  ]);
  assert.ok(LOCAL_TTS_VOICES.every((voice) => /^[a-f0-9]{64}$/u.test(voice.sha256)));
  assert.equal(LOCAL_TTS_SEGMENTS.length, VISUAL_PROOF_SHOTS.length);
  for (const [index, segment] of LOCAL_TTS_SEGMENTS.entries()) {
    assert.equal(segment.start, VISUAL_PROOF_SHOTS[index].start);
    assert.equal(segment.end, VISUAL_PROOF_SHOTS[index].end);
    assert.doesNotMatch(segment.text, /\b(?:Agent|Skill)\b/iu);
  }
  assert.match(localTtsSpokenTextAt(20), /重复粘贴/u);
  assert.match(localTtsSpokenTextAt(54), /共享技能/u);
  assert.equal(LOCAL_TTS_SUBTITLES[0].start, 0);
  assert.equal(LOCAL_TTS_SUBTITLES.at(-1).end, 59.3);
  assert.ok(LOCAL_TTS_SUBTITLES.every((subtitle) => subtitle.end > subtitle.start));
  assert.ok(LOCAL_TTS_SUBTITLES.every((subtitle) => subtitle.text.length <= 30));
  assert.match(localTtsSubtitleAt(16), /智能体/u);
  assert.equal(localTtsSubtitleAt(59.7), "");
});

test("本地 TTS 生成器强制离线、阻断 socket，并保持 Episode 只读", async () => {
  const [builder, generator] = await Promise.all([
    readFile(resolve(studioRoot, "scripts", "build-agent-skill-local-tts-proof.mjs"), "utf8"),
    readFile(resolve(studioRoot, "scripts", "generate-agent-skill-local-tts.py"), "utf8")
  ]);
  for (const variable of ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE"]) {
    assert.match(builder, new RegExp(`${variable}: "1"`, "u"));
  }
  assert.match(builder, /paidApiCalls:\s*0/u);
  assert.match(builder, /externalInferenceCalls:\s*0/u);
  assert.match(builder, /textUploadCalls:\s*0/u);
  assert.doesNotMatch(builder, /\.\.\.process\.env/u);
  assert.match(generator, /socket\.socket\.connect = block_network/u);
  assert.match(generator, /socket\.create_connection = block_network/u);
  assert.match(generator, /socket\.getaddrinfo = block_network/u);
  assert.match(generator, /socket\.socket\.sendto = block_network/u);
  assert.doesNotMatch(`${builder}\n${generator}`, /writeEpisode|saveVoiceUpload/u);
  assert.equal(nextLocalTtsProofVersion([]), 1);
  assert.equal(nextLocalTtsProofVersion(["local-tts-proof-v001.wav"]), 2);
  assert.equal(nextLocalTtsProofVersion(["local-tts-proof-v002.rendering.wav"]), 3);
  assert.equal(nextLocalTtsScreenVersion(["local-tts-voice-screen-v001"]), 2);
});

test("视觉样片输出按版本递增并保护既有视频和抽帧", () => {
  assert.equal(nextVisualProofVersion([]), 1);
  assert.equal(nextVisualProofVersion(["visual-proof-v001.mp4"]), 2);
  assert.equal(nextVisualProofVersion(["visual-proof-v001-stills"]), 2);
  assert.equal(
    nextVisualProofVersion([
      "visual-proof-v001.mp4",
      "visual-proof-v002-manifest.json",
      "visual-proof-v003.rendering.mp4"
    ]),
    4
  );
});
