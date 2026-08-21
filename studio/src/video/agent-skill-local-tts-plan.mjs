import { NATURAL_VOICE_SEGMENTS } from "./agent-skill-natural-voice-plan.mjs";

export const LOCAL_TTS_PROOF_DURATION_SECONDS = 60;
export const LOCAL_TTS_SAMPLE_RATE = 24000;
export const LOCAL_TTS_DIRECTION = "温和年轻男声，知识类创作者自然讲解";

export const LOCAL_TTS_MODEL = Object.freeze({
  repoId: "hexgrad/Kokoro-82M-v1.1-zh",
  revision: "01e7505bd6a7a2ac4975463114c3a7650a9f7218",
  fileName: "kokoro-v1_1-zh.pth",
  sha256: "b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b",
  configSha256: "bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890",
  codeRepoId: "hexgrad/kokoro",
  codeRevision: "dfb907a02bba8152ca444717ca5d78747ccb4bec",
  languageCode: "z"
});

export const LOCAL_TTS_VOICES = Object.freeze([
  Object.freeze({
    id: "zm_010",
    sha256: "d2eeba86192eee269f600ca6821038034abd017532a1fe68ff7b0e86c2983b2a"
  }),
  Object.freeze({
    id: "zm_020",
    sha256: "18fcd9dae42bd075603858f41400ef83775e6d3aef22c7a28fd375e8ce2e65e6"
  }),
  Object.freeze({
    id: "zm_045",
    sha256: "adf8382d07e442084824ace7b270e30e3ef1fcaab211fdea39aa28ddcfcdf418"
  }),
  Object.freeze({
    id: "zm_061",
    sha256: "700357029a04e1fd5c5c5ca19b17e1fcf69e4d9c0b89a63087c727b6acf3f2d8"
  })
]);

export const LOCAL_TTS_DEFAULT_VOICE = "zm_010";
export const LOCAL_TTS_CANDIDATE_TEXT = NATURAL_VOICE_SEGMENTS[0].text;

const spokenTextById = Object.freeze({
  hook: NATURAL_VOICE_SEGMENTS[0].text,
  "prompt-repeat":
    "有人改了两句话，下次又不知道该用哪一版。它该继续留在聊天框里，还是变成智能体能反复调用的能力？",
  "prompt-to-skill": NATURAL_VOICE_SEGMENTS[2].text,
  "knowledge-merge":
    "真正缺的，是一个能被找到、复用，也能持续维护的工作单元。把它整理成可复用的智能体技能，团队方法才真正沉淀下来。",
  "skill-discovery":
    "智能体会先判断任务是否匹配，等真正需要时，再读取对应的方法和资源，不必每次塞满上下文。",
  "team-example":
    "比如做竞品分析，三位同事可以一起，把各自的经验沉淀成一个共享技能。"
});

export const LOCAL_TTS_SEGMENTS = Object.freeze(
  NATURAL_VOICE_SEGMENTS.map((segment) => Object.freeze({
    id: segment.id,
    start: segment.start,
    end: segment.end,
    preferredSpeed: 1,
    text: spokenTextById[segment.id]
  }))
);

export const LOCAL_TTS_SUBTITLES = Object.freeze([
  { start: 0, end: 2, text: "你有没有遇到过这种情况？" },
  { start: 2, end: 5.4, text: "同一套提示词，每周都要从聊天记录里翻出来，" },
  { start: 5.4, end: 7.7, text: "再复制一遍。" },
  { start: 8, end: 10.9, text: "有人改了两句话，" },
  { start: 10.9, end: 13.8, text: "下次又不知道该用哪一版。" },
  { start: 13.8, end: 15.6, text: "它该继续留在聊天框里，" },
  { start: 15.6, end: 17.65, text: "还是变成智能体能反复调用的能力？" },
  { start: 18, end: 21.1, text: "如果团队总在重复粘贴同样的背景、步骤和注意事项，" },
  { start: 21.1, end: 24.4, text: "问题其实已经不只是提示词够不够长，" },
  { start: 24.4, end: 29.7, text: "而是这些经验始终散在不同对话里。" },
  { start: 30, end: 33.7, text: "真正缺的，是一个能被找到、复用，" },
  { start: 33.7, end: 36.2, text: "也能持续维护的工作单元。" },
  { start: 36.2, end: 39.8, text: "把它整理成可复用的智能体技能，" },
  { start: 39.8, end: 41.6, text: "团队方法才真正沉淀下来。" },
  { start: 42, end: 45, text: "智能体会先判断任务是否匹配，" },
  { start: 45, end: 48.8, text: "等真正需要时，再读取对应的方法和资源，" },
  { start: 48.8, end: 51.55, text: "不必每次塞满上下文。" },
  { start: 52, end: 54.5, text: "比如做竞品分析，" },
  { start: 54.5, end: 57.2, text: "三位同事可以一起，" },
  { start: 57.2, end: 59.3, text: "把各自的经验沉淀成一个共享技能。" }
]);

export function localTtsSpokenTextAt(second) {
  return LOCAL_TTS_SEGMENTS.find(
    (segment) => second >= segment.start && second < segment.end
  )?.text ?? "";
}

export function localTtsSubtitleAt(second) {
  return LOCAL_TTS_SUBTITLES.find(
    (subtitle) => second >= subtitle.start && second < subtitle.end
  )?.text ?? "";
}

export function nextLocalTtsProofVersion(files) {
  const highest = files.reduce((current, file) => {
    const match = /^local-tts-proof-v(\d{3})(?:\.wav|-manifest\.json|\.rendering\.wav)$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return highest + 1;
}

export function nextLocalTtsScreenVersion(files) {
  const highest = files.reduce((current, file) => {
    const match = /^local-tts-voice-screen-v(\d{3})(?:\.rendering)?$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return highest + 1;
}
