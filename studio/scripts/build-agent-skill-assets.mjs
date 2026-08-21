import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execute = promisify(execFile);
const outputDirectory = resolve("data/fixtures/agent-skill-assets");

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textLines(lines, x, y, options = {}) {
  const size = options.size ?? 32;
  const lineHeight = options.lineHeight ?? Math.round(size * 1.45);
  const color = options.color ?? "#1f2a44";
  const weight = options.weight ?? 500;
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * lineHeight}" font-family="PingFang SC, Hiragino Sans GB, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`
  ).join("");
}

function assetSvg(asset) {
  const cards = asset.cards.map((card, index) => {
    const y = 430 + index * 245;
    return `
      <rect x="96" y="${y}" width="888" height="196" rx="34" fill="#ffffff" stroke="#d8def7" stroke-width="3"/>
      <circle cx="166" cy="${y + 58}" r="34" fill="${card.accent ?? "#7057ff"}"/>
      ${textLines([card.index], 150, y + 70, { size: 28, color: "#ffffff", weight: 700 })}
      ${textLines([card.title], 224, y + 60, { size: 35, weight: 700 })}
      ${textLines(card.lines, 224, y + 112, { size: 27, color: "#55627e", lineHeight: 39 })}
    `;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7f9ff"/>
      <stop offset="0.52" stop-color="#eef0ff"/>
      <stop offset="1" stop-color="#fff3eb"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <circle cx="880" cy="150" r="260" fill="#7057ff" opacity="0.08"/>
  <circle cx="90" cy="1760" r="300" fill="#ff8b3d" opacity="0.08"/>
  <rect x="72" y="82" width="250" height="54" rx="27" fill="#1c2a4a"/>
  ${textLines(["AGENT SKILL"], 108, 120, { size: 25, color: "#ffffff", weight: 700 })}
  ${textLines(asset.title, 82, 235, { size: 54, color: "#17213a", weight: 750, lineHeight: 72 })}
  ${textLines(asset.subtitle, 86, 360, { size: 29, color: "#64708d", lineHeight: 43 })}
  ${cards}
  <rect x="80" y="1718" width="920" height="112" rx="30" fill="#17213a"/>
  ${textLines(asset.footer, 124, 1766, { size: 28, color: "#ffffff", lineHeight: 40, weight: 600 })}
</svg>`;
}

const assets = [
  {
    id: "skill-anatomy",
    title: ["Skill 不是更长的 Prompt", "而是可维护的能力单元"],
    subtitle: ["把触发条件、过程知识、资源和验收标准", "放进可发现、可版本化的目录"],
    cards: [
      { index: "01", title: "名称与描述", lines: ["先帮助 Agent 判断", "什么时候应该调用"] },
      { index: "02", title: "SKILL.md", lines: ["记录执行步骤、边界", "以及完成标准"], accent: "#ff8b3d" },
      { index: "03", title: "scripts / references", lines: ["按需加载脚本、资料", "不一次塞进上下文"] },
      { index: "04", title: "assets", lines: ["复用模板与视觉资源", "保持交付一致"] },
      { index: "05", title: "版本与评测", lines: ["变更可审查、可比较", "出现问题能够回退"], accent: "#1fa67a" }
    ],
    footer: ["判断标准：稳定、重复、可验收、可复用", "来源：已批准研究包与 Agent Skills 官方规范"]
  },
  {
    id: "progressive-loading",
    title: ["渐进式加载", "把上下文留给当前任务"],
    subtitle: ["先路由，再读说明，最后按需读取资源", "每一层只在真正需要时进入上下文"],
    cards: [
      { index: "01", title: "元数据", lines: ["名称 + 描述", "用于发现与匹配"] },
      { index: "02", title: "完整说明", lines: ["命中任务后读取", "SKILL.md 工作流程"], accent: "#ff8b3d" },
      { index: "03", title: "参考资料", lines: ["需要事实或规范时", "再读取 references"] },
      { index: "04", title: "脚本与资产", lines: ["执行到对应步骤时", "调用 scripts / assets"] },
      { index: "05", title: "受控执行", lines: ["遵守工具权限、预算", "审核和人工闸门"], accent: "#1fa67a" }
    ],
    footer: ["描述过宽会误触发，描述过窄会漏掉任务", "来源：Agent Skills 规范与官方工程说明"]
  },
  {
    id: "skill-tool-mcp",
    title: ["Skill、Tool 与 MCP", "解决的是三个不同层次"],
    subtitle: ["方法、动作、连接协议可以组合", "但不能彼此替代"],
    cards: [
      { index: "01", title: "Skill｜怎样做", lines: ["过程知识、顺序", "边界与验收标准"] },
      { index: "02", title: "Tool｜做一个动作", lines: ["查询、读取、写入", "或执行受控操作"], accent: "#ff8b3d" },
      { index: "03", title: "MCP｜怎样连接", lines: ["统一暴露 prompts", "resources 与 tools"] },
      { index: "04", title: "组合方式", lines: ["Skill 规定何时、为何", "调用哪个 MCP Tool"] },
      { index: "05", title: "共同边界", lines: ["权限、审计、失败处理", "最终由人决定采用"], accent: "#1fa67a" }
    ],
    footer: ["只有 Tool 缺少方法；只有 Skill 缺少执行能力", "来源：MCP 官方规范、OpenAI Plugins 与已批准脚本"]
  },
  {
    id: "skill-decision",
    title: ["什么时候值得做成 Skill？", "先看任务是否已经稳定"],
    subtitle: ["不要因为能自动化就立刻固化", "先用代表性任务验证方法"],
    cards: [
      { index: "01", title: "稳定", lines: ["目标与关键步骤", "不再频繁变化"] },
      { index: "02", title: "重复", lines: ["真实任务反复出现", "不是一次性探索"], accent: "#ff8b3d" },
      { index: "03", title: "可验收", lines: ["失败能被发现", "结果有完成标准"] },
      { index: "04", title: "可复用", lines: ["能跨人、跨任务", "减少重复返工"] },
      { index: "05", title: "可治理", lines: ["依赖、权限、版本", "更新和回退可控"], accent: "#1fa67a" }
    ],
    footer: ["上线前追问：何时触发、需要什么、谁能执行、怎样验收、如何回退", "来源：已批准研究与脚本"]
  },
  {
    id: "skill-governance",
    title: ["Skill 治理闭环", "安全不是上传之后再补"],
    subtitle: ["把 Skill 当作软件供应链资产", "每个阶段都留下责任和证据"],
    cards: [
      { index: "01", title: "发布前", lines: ["核验来源、审查代码", "声明依赖与权限"] },
      { index: "02", title: "安装时", lines: ["按角色和数据范围", "授予最小权限"], accent: "#ff8b3d" },
      { index: "03", title: "运行中", lines: ["记录触发、工具调用", "结果和失败原因"] },
      { index: "04", title: "更新后", lines: ["旧审核自动失效", "固定样例重新评测"] },
      { index: "05", title: "异常时", lines: ["能够停用、隔离", "并回退到安全版本"], accent: "#1fa67a" }
    ],
    footer: ["平台扫描降低风险，但不能替代组织自己的判断", "来源：官方安全说明与已批准脚本"]
  }
];

await mkdir(outputDirectory, { recursive: true });
const outputs = [];
for (const asset of assets) {
  const svgPath = resolve(outputDirectory, `${asset.id}.svg`);
  const pngPath = resolve(outputDirectory, `${asset.id}.png`);
  await writeFile(svgPath, assetSvg(asset), "utf8");
  try {
    await execute("/usr/bin/sips", ["-s", "format", "png", svgPath, "--out", pngPath]);
  } catch {
    const previewDirectory = resolve(outputDirectory, ".preview");
    await mkdir(previewDirectory, { recursive: true });
    await execute("/usr/bin/qlmanage", ["-t", "-s", "1920", "-o", previewDirectory, svgPath]);
    await rename(resolve(previewDirectory, `${asset.id}.svg.png`), pngPath);
    await rm(previewDirectory, { recursive: true, force: true });
  }
  outputs.push(pngPath);
}

console.log(JSON.stringify({ outputDirectory, outputs }, null, 2));
