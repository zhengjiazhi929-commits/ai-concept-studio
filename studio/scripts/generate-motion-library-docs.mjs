import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AMICRO_UPSTREAM,
  MOTION_LIBRARY_CATEGORIES,
  MOTION_LIBRARY_ITEMS,
  motionLibraryItemsByCategory
} from "../src/video/motion-library/catalog.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const studioDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(studioDirectory, "..");
const outputPath = path.join(repositoryDirectory, "docs", "07-motion-library.md");

function quote(value) {
  return value.map((item) => `\`${item}\``).join("、");
}

const lines = [
  "# 视频动效组件库",
  "",
  `本库从 [Amicro](${AMICRO_UPSTREAM.repository}) 中筛选并改写了 ${MOTION_LIBRARY_ITEMS.length} 个适合横版 AI 概念视频的动效。上游源码固定在提交 \`${AMICRO_UPSTREAM.commit}\`，授权为 ${AMICRO_UPSTREAM.license}。`,
  "",
  "这里的 GIF 是人工选型入口；真正用于成片的是同一套 Remotion 帧驱动组件。GIF 的第一帧和最后一帧可无缝衔接，组件不依赖鼠标悬停、CSS transition、CSS animation 或随机数。",
  "",
  "## 使用",
  "",
  "本地逐帧预览全部组件：",
  "",
  "```bash",
  "cd studio",
  "pnpm motion:gallery",
  "```",
  "",
  "在 Remotion 场景中调用：",
  "",
  "```jsx",
  "import {MotionLibraryEffect} from './motion-library/library.jsx';",
  "",
  "<MotionLibraryEffect",
  "  effectId=\"circuit-trace-draw\"",
  "  startFrame={90}",
  "  durationInFrames={72}",
  "/>",
  "```",
  "",
  "默认规则：仅横版；薄荷约 80%、紫色约 20%；平面组件优先；同层级表面一致；字幕不得调用本库文字动效；非小型独立模块不得再套大卡片。",
  "",
  "## 人工预览目录",
  ""
];

for (const category of MOTION_LIBRARY_CATEGORIES) {
  const items = motionLibraryItemsByCategory(category.id);
  lines.push(`### ${category.order}. ${category.label}`, "");
  for (const item of items) {
    const imagePath = `./assets/motion-library/${item.category}/${item.id}.gif`;
    lines.push(
      `#### ${item.titleZh} · \`${item.id}\``,
      "",
      `![${item.titleZh}](${imagePath})`,
      "",
      item.summary,
      "",
      `适合：${quote(item.useWhen)}`,
      "",
      `避免：${quote(item.avoidWhen)}`,
      ""
    );
  }
}

lines.push(
  "## 来源与维护",
  "",
  "- 上游原始文件保存在 `studio/src/video/motion-library/upstream/amicro/`，并带有选择清单、哈希和授权说明。",
  "- `pnpm motion:archive` 按固定提交重新核验并归档上游文件。",
  "- `pnpm motion:previews` 重新渲染全部 GIF。",
  "- `pnpm motion:check` 检查目录、归档、GIF 尺寸、大小与完整性。",
  "- 新增动效前先写清使用场景和禁用场景，再进入组件注册表，避免 Agent 只凭名字误选。",
  ""
);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`wrote ${path.relative(repositoryDirectory, outputPath)}`);
