import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { resolveBrowserExecutable } from '../src/server/renderer.mjs';
import { videoRoot, workspaceRoot } from '../src/shared/paths.mjs';
import { resolveEditorialMotionFrame, validateEditorialMotionPlan } from '../src/shared/editorial-motion.mjs';
import { editorialMotionRendererFixture } from '../tests/editorial-motion-renderer-fixture.mjs';
import { auditPngFrameSet, decodePngPixels } from './ci-png-audit.mjs';

export const CI_EDITORIAL_MOTION_FRAMES = Object.freeze([19, 40, 50, 60, 90]);
export const CI_EDITORIAL_WATERMARK_FRAMES = Object.freeze([0, ...CI_EDITORIAL_MOTION_FRAMES]);
const assetFolder = 'assets/visual-system-v1/ai-watermark-v013/frames';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const execute = promisify(execFile);

export function parseEditorialSmokeArguments(args) {
  if (!Array.isArray(args) || (args.length !== 0 && !(args.length === 1 && args[0] === '--keep-frames'))) {
    throw new Error('Editorial smoke accepts only --keep-frames; live input is not supported');
  }
  return { keepFrames: args.length === 1 };
}

async function copyTrackedWatermarks(publicDirectory) {
  const relativePaths = CI_EDITORIAL_WATERMARK_FRAMES.map((frame) =>
    `studio/public/${assetFolder}/frame-${String(frame).padStart(3, '0')}.png`);
  // A minimal public root must never traverse the mutable live episode tree.
  await execute('git', ['ls-files', '--error-unmatch', '--', ...relativePaths], { cwd: workspaceRoot });
  await mkdir(resolve(publicDirectory, assetFolder), { recursive: true });
  const assets = [];
  for (const relativePath of relativePaths) {
    const source = resolve(workspaceRoot, relativePath);
    if (!(await lstat(source)).isFile() || await realpath(source) !== source) {
      throw new Error('Editorial smoke watermark must be a regular tracked file without symlinks');
    }
    const bytes = await readFile(source);
    const publicPath = relativePath.slice('studio/public/'.length);
    await writeFile(resolve(publicDirectory, publicPath), bytes, { flag: 'wx' });
    assets.push({ path: relativePath, sha256: sha256(bytes), pixelSha256: sha256(decodePngPixels(bytes).pixels), bytes: bytes.length });
  }
  return assets;
}

function cropStats(decoded, rectangle) {
  const pixels = Buffer.alloc(rectangle.width * rectangle.height * 4);
  const colors = new Set();
  for (let row = 0; row < rectangle.height; row += 1) {
    const start = ((rectangle.y + row) * decoded.width + rectangle.x) * 4;
    decoded.pixels.copy(pixels, row * rectangle.width * 4, start, start + rectangle.width * 4);
  }
  for (let offset = 0; offset < pixels.length; offset += 4) colors.add(pixels.readUInt32BE(offset));
  return { pixelSha256: sha256(pixels), uniqueColors: colors.size };
}

function auditEditorialFrames(frameBuffers, assets, episode) {
  const audit = auditPngFrameSet(frameBuffers, { expectedWidth: 1920, expectedHeight: 1080 });
  const regions = frameBuffers.map(({ frame, bytes }) => {
    const decoded = decodePngPixels(bytes);
    for (let offset = 3; offset < decoded.pixels.length; offset += 4) {
      if (decoded.pixels[offset] !== 255) throw new Error(`Editorial smoke frame ${frame} is not fully opaque`);
    }
    const content = cropStats(decoded, { x: 96, y: 300, width: 1728, height: 580 });
    const logo = cropStats(decoded, { x: 1740, y: 24, width: 156, height: 160 });
    if (content.uniqueColors < 16 || logo.uniqueColors < 16) throw new Error('Editorial smoke content or logo is visually empty');
    return { frame, contentPixelSha256: content.pixelSha256, logoPixelSha256: logo.pixelSha256, fullyOpaque: true };
  });
  const distinctContentFrames = new Set(regions.map((item) => item.contentPixelSha256)).size;
  const distinctLogoFrames = new Set(regions.map((item) => item.logoPixelSha256)).size;
  if (distinctContentFrames < CI_EDITORIAL_MOTION_FRAMES.length - 1) {
    throw new Error('Editorial content did not visibly change independently of logo and captions');
  }
  const sourceLogoHashes = CI_EDITORIAL_MOTION_FRAMES.map((frame) => {
    const path = `studio/public/${assetFolder}/frame-${String(frame).padStart(3, '0')}.png`;
    return assets.find((asset) => asset.path === path)?.pixelSha256;
  });
  const expectedDistinctLogoFrames = new Set(sourceLogoHashes).size;
  if (sourceLogoHashes.some((hash) => !hash) || expectedDistinctLogoFrames < 2) throw new Error('Approved watermark fixture has no verifiable motion');
  // The approved raster has identical poses at some frame numbers. Preserve
  // that asset; compare its actual equivalence groups instead of demanding
  // invented every-frame uniqueness or silently disabling the logo assertion.
  for (let first = 0; first < regions.length; first += 1) {
    for (let second = first + 1; second < regions.length; second += 1) {
      if ((sourceLogoHashes[first] === sourceLogoHashes[second])
        !== (regions[first].logoPixelSha256 === regions[second].logoPixelSha256)) {
        throw new Error('Editorial watermark frame changes disagree with the approved source assets');
      }
    }
  }
  if (distinctLogoFrames !== expectedDistinctLogoFrames) throw new Error('Editorial watermark motion differs from approved assets');
  const before = decodePngPixels(frameBuffers.find((item) => item.frame === 19).bytes);
  const midway = decodePngPixels(frameBuffers.find((item) => item.frame === 50).bytes);
  const resolved = resolveEditorialMotionFrame(episode.scenes[0].motionPlan, 50);
  const source = resolved.objects.find((object) => object.id === 'source');
  const copy = resolved.objects.find((object) => object.id === 'copy');
  if (!source.visible || !copy.visible || copy.information.status !== 'in-transit'
    || copy.x <= source.x + source.width || copy.information.containerId !== null) {
    throw new Error('Editorial midpoint fixture does not independently display source and in-transit copy');
  }
  const sourceRectangle = { x: Math.floor(source.x), y: Math.floor(source.y), width: source.width, height: source.height };
  const copyRectangle = { x: Math.floor(copy.x), y: Math.floor(copy.y), width: copy.width, height: copy.height };
  const beforeSource = cropStats(before, sourceRectangle);
  const midwaySource = cropStats(midway, sourceRectangle);
  const beforeCopyRegion = cropStats(before, copyRectangle);
  const midwayCopyRegion = cropStats(midway, copyRectangle);
  if (beforeSource.pixelSha256 !== midwaySource.pixelSha256) throw new Error('Original source pixels changed during copy transfer');
  if (beforeCopyRegion.pixelSha256 === midwayCopyRegion.pixelSha256 || midwayCopyRegion.uniqueColors < 16) {
    throw new Error('No independently visible copied page at the actual transfer midpoint');
  }
  return { ...audit, regions, distinctContentFrames, distinctLogoFrames, expectedDistinctLogoFrames,
    inTransitProof: { frame: 50, originalSourceUnchanged: true, copiedPageVisible: true,
      sourcePixelSha256: midwaySource.pixelSha256, copiedPagePixelSha256: midwayCopyRegion.pixelSha256 } };
}

export async function runCiEditorialMotionSmoke(options = {}) {
  if (Object.keys(options).some((key) => key !== 'keepFrames')
    || (options.keepFrames !== undefined && typeof options.keepFrames !== 'boolean')) {
    throw new Error('Editorial smoke only accepts keepFrames');
  }
  const episode = editorialMotionRendererFixture();
  episode.render = { compositionId: 'ConceptPreview', width: 1920, height: 1080, fps: 30, durationSeconds: 6 };
  const review = validateEditorialMotionPlan(episode.scenes[0].motionPlan, {
    narration: episode.scenes[0].narration, durationInFrames: 180,
  });
  if (!review.valid || review.warnings?.length) throw new Error(`Editorial synthetic fixture failed: ${JSON.stringify(review)}`);
  const browserExecutable = await resolveBrowserExecutable(null);
  if (!browserExecutable) throw new Error('Editorial smoke requires installed local Chrome/Chromium; browser download is disabled');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'acs-ci-editorial-motion-'));
  const publicDirectory = resolve(temporaryRoot, 'public');
  const bundleDirectory = resolve(temporaryRoot, 'bundle');
  let succeeded = false;
  try {
    const assets = await copyTrackedWatermarks(publicDirectory);
    const serveUrl = await bundle({ entryPoint: resolve(videoRoot, 'index.jsx'), outDir: bundleDirectory,
      publicDir: publicDirectory, symlinkPublicDir: false, onProgress: () => undefined });
    const inputProps = { episode };
    const browserOptions = { browserExecutable, chromeMode: 'chrome-for-testing', timeoutInMilliseconds: 120000, logLevel: 'warn' };
    const composition = await selectComposition({ serveUrl, id: 'ConceptPreview', inputProps, ...browserOptions });
    const frameBuffers = [];
    const outputFiles = [];
    for (const frame of CI_EDITORIAL_MOTION_FRAMES) {
      const output = resolve(temporaryRoot, `editorial-frame-${frame}.png`);
      await renderStill({ composition, serveUrl, inputProps, output, frame, imageFormat: 'png', overwrite: false, ...browserOptions });
      const bytes = await readFile(output);
      frameBuffers.push({ frame, bytes });
      outputFiles.push({ frame, file: `editorial-frame-${frame}.png`, sha256: sha256(bytes), bytes: bytes.length });
    }
    const report = { kind: 'synthetic-editorial-renderer-pixel-smoke-v1', assurance: 'synthetic-stills-not-film-visual-acceptance',
      compositionId: 'ConceptPreview', fixtureId: episode.id, fixtureSha256: sha256(JSON.stringify(episode)),
      nodeVersion: process.version, browserExecutable, assets, frames: outputFiles, audit: auditEditorialFrames(frameBuffers, assets, episode) };
    await writeFile(resolve(temporaryRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    succeeded = true;
    return { ...report, ...(options.keepFrames ? { retainedDirectory: temporaryRoot } : {}) };
  } finally {
    if (options.keepFrames && succeeded) {
      await rm(bundleDirectory, { recursive: true, force: true });
      await rm(publicDirectory, { recursive: true, force: true });
    } else {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await runCiEditorialMotionSmoke(parseEditorialSmokeArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result));
}
