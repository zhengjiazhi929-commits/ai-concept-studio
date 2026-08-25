import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSupportedMediaSignature,
  inspectSupportedMedia,
  supportedMediaSignature
} from "../src/server/production/media-signatures.mjs";

function pcmWav(seconds = 1, sampleRate = 24_000) {
  const sampleCount = seconds * sampleRate;
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(index % 2 === 0 ? 1_000 : -1_000, 44 + index * 2);
  }
  return buffer;
}

test("上传媒体的声明格式必须与最小文件头一致", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]);
  const mp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
  assert.equal(supportedMediaSignature(png, ".png"), true);
  assert.equal(supportedMediaSignature(mp3, ".mp3"), true);
  assert.equal(supportedMediaSignature(mp4, ".mp4"), true);
  assert.equal(supportedMediaSignature(Buffer.from("not-a-png"), ".png"), false);
});

test("伪装扩展名的上传在任何文件写入前 fail closed", () => {
  assert.throws(
    () => assertSupportedMediaSignature(Buffer.from("synthetic text"), ".wav"),
    (error) => error.code === "media_signature_invalid" && error.statusCode === 400
  );
});

test("本地隔离解析器实际读取并解码媒体，只有魔数的伪文件仍会被拒绝", async () => {
  const inspection = await inspectSupportedMedia(pcmWav(), ".wav");
  assert.equal(inspection.kind, "audio");
  assert.equal(inspection.sampleRate, 24_000);
  assert.equal(inspection.channels, 1);
  assert.equal(inspection.decoder, "remotion-bundled-ffmpeg");

  const fakePng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("not-a-decodable-image", "utf8")
  ]);
  await assert.rejects(
    inspectSupportedMedia(fakePng, ".png"),
    (error) => error.code === "media_content_invalid" && error.statusCode === 400
  );
});
