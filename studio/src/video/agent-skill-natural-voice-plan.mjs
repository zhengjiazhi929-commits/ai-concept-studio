export const NATURAL_VOICE_PROOF_DURATION_SECONDS = 60;
export const NATURAL_VOICE_NAME = "Reed (中文（中国大陆）)";

export const NATURAL_VOICE_SEGMENTS = Object.freeze([
  {
    id: "hook",
    start: 0,
    end: 8,
    rate: 182,
    text: "你有没有遇到过这种情况？同一套提示词，每周都要从聊天记录里翻出来，再复制一遍。"
  },
  {
    id: "prompt-repeat",
    start: 8,
    end: 18,
    rate: 182,
    text: "有人改了两句话，下次又不知道该用哪一版。它该继续留在聊天框里，还是变成 Agent 能反复调用的能力？"
  },
  {
    id: "prompt-to-skill",
    start: 18,
    end: 30,
    rate: 178,
    text: "如果团队总在重复粘贴同样的背景、步骤和注意事项，问题其实已经不只是提示词够不够长，而是这些经验始终散在不同对话里。"
  },
  {
    id: "knowledge-merge",
    start: 30,
    end: 42,
    rate: 174,
    text: "真正缺的，是一个能被找到、复用，也能持续维护的工作单元。把它整理成 Agent Skill，团队方法才真正沉淀下来。"
  },
  {
    id: "skill-discovery",
    start: 42,
    end: 52,
    rate: 178,
    text: "Agent 会先判断任务是否匹配，等真正需要时，再读取对应的方法和资源，不必每次塞满上下文。"
  },
  {
    id: "team-example",
    start: 52,
    end: 60,
    rate: 180,
    text: "比如做竞品分析，三位同事可以一起，把各自的经验沉淀成一个共享 Skill。"
  }
]);

export function naturalVoiceSubtitleAt(second) {
  return NATURAL_VOICE_SEGMENTS.find(
    (segment) => second >= segment.start && second < segment.end
  )?.text ?? "";
}

export function nextNaturalVoiceProofVersion(files) {
  const highest = files.reduce((current, file) => {
    const match = /^natural-voice-proof-v(\d{3})(?:\.wav|-manifest\.json)$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return highest + 1;
}
