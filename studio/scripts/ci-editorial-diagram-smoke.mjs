import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {resolveBrowserExecutable} from '../src/server/renderer.mjs';
import {videoRoot, workspaceRoot} from '../src/shared/paths.mjs';
import {compileEditorialMotionRenderEpisode, buildEditorialMotionRenderModel} from '../src/video/editorial-motion-render-model.mjs';
import {EDITORIAL_DIAGRAM_SMOKE_FRAMES, editorialDiagramSmokeFixture} from '../tests/editorial-diagram-smoke-fixture.mjs';
import {auditPngFrameSet, decodePngPixels} from './ci-png-audit.mjs';

export {EDITORIAL_DIAGRAM_SMOKE_FRAMES};
const assetFolder = 'assets/visual-system-v1/ai-watermark-v013/frames';
const sha = value => createHash('sha256').update(value).digest('hex');
const execute = promisify(execFile);
const need = (condition, message) => {if (!condition) throw new Error(`Editorial diagram smoke: ${message}`);};

export function parseEditorialDiagramSmokeArguments(args) {
  need(Array.isArray(args) && (args.length === 0 || args.length === 1 && args[0] === '--keep-frames'),
    'only --keep-frames is accepted; live inputs are forbidden');
  return {keepFrames: args.length === 1};
}

function checkedOptions(options) {
  need(options && typeof options === 'object' && [null, Object.prototype].includes(Object.getPrototypeOf(options)), 'invalid options');
  need(Reflect.ownKeys(options).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    return key === 'keepFrames' && descriptor.enumerable && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'boolean';
  }), 'options are closed plain data');
  return options;
}

async function copyTrackedAssets(publicDirectory) {
  const indices = [...new Set(EDITORIAL_DIAGRAM_SMOKE_FRAMES.map(frame => frame % 120))];
  const relativePaths = indices.map(frame => `studio/public/${assetFolder}/frame-${String(frame).padStart(3, '0')}.png`);
  await execute('git', ['ls-files', '--error-unmatch', '--', ...relativePaths], {cwd: workspaceRoot});
  await mkdir(resolve(publicDirectory, assetFolder), {recursive: true});
  const assets = [];
  for (const path of relativePaths) {
    const source = resolve(workspaceRoot, path);
    need((await lstat(source)).isFile() && await realpath(source) === source, 'asset must be a regular tracked file, not a symlink');
    const bytes = await readFile(source);
    await writeFile(resolve(publicDirectory, path.slice('studio/public/'.length)), bytes, {flag: 'wx'});
    assets.push({path, sha256: sha(bytes), pixelSha256: sha(decodePngPixels(bytes).pixels)});
  }
  return assets;
}

function crop(decoded, rect) {
  need(Number.isInteger(rect.x) && Number.isInteger(rect.y) && rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= decoded.width && rect.y + rect.height <= decoded.height, 'invalid pixel region');
  const bytes = Buffer.alloc(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row += 1) {
    const start = ((rect.y + row) * decoded.width + rect.x) * 4;
    decoded.pixels.copy(bytes, row * rect.width * 4, start, start + rect.width * 4);
  }
  return bytes;
}
function colorCount(bytes, rgb, tolerance = 5) {
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (rgb.every((value, channel) => Math.abs(value - bytes[offset + channel]) <= tolerance) && bytes[offset + 3] === 255) count += 1;
  }
  return count;
}
const colors = bytes => new Set(Array.from({length: bytes.length / 4}, (_, index) => bytes.readUInt32BE(index * 4))).size;

export function auditEditorialDiagramPixels(frameBuffers, assets, episode) {
  need(JSON.stringify(frameBuffers.map(item => item.frame)) === JSON.stringify(EDITORIAL_DIAGRAM_SMOKE_FRAMES), 'exact frame set required');
  const audit = auditPngFrameSet(frameBuffers, {expectedWidth: 1920, expectedHeight: 1080});
  const decoded = new Map(frameBuffers.map(item => [item.frame, decodePngPixels(item.bytes)]));
  const regions = frameBuffers.map(({frame}) => {
    const image = decoded.get(frame);
    for (let offset = 3; offset < image.pixels.length; offset += 4) need(image.pixels[offset] === 255, `frame ${frame} is not opaque`);
    const content = crop(image, {x: 96, y: 300, width: 1728, height: 580});
    const logo = crop(image, {x: 1740, y: 24, width: 156, height: 160});
    const chapters = crop(image, {x: 96, y: 1020, width: 1728, height: 55});
    need(colors(content) > 16 && colors(logo) > 16 && colors(chapters) > 16, 'content/logo/chapters must be independently nonblank');
    return {frame, contentSha256: sha(content), logoSha256: sha(logo), chaptersSha256: sha(chapters), fullyOpaque: true};
  });
  need(new Set(regions.map(item => item.contentSha256)).size === 4, 'content did not change independently of logo/subtitles');
  const sourceLogoHashes = EDITORIAL_DIAGRAM_SMOKE_FRAMES.map(frame => assets.find(asset =>
    asset.path.endsWith(`/frame-${String(frame % 120).padStart(3, '0')}.png`))?.pixelSha256);
  need(sourceLogoHashes.every(Boolean) && new Set(sourceLogoHashes).size > 1, 'watermark fixture must contain actual distinct poses');
  for (let a = 0; a < regions.length; a += 1) for (let b = a + 1; b < regions.length; b += 1) {
    need((sourceLogoHashes[a] === sourceLogoHashes[b]) === (regions[a].logoSha256 === regions[b].logoSha256), 'global logo cadence drift');
  }
  const corridor = {x: 790, y: 625, width: 300, height: 20};
  const gateOutlinePixels = colorCount(crop(decoded.get(0), {x: 330, y: 480, width: 220, height: 160}), [90, 138, 119]);
  const processorOutlinePixels = colorCount(crop(decoded.get(0), {x: 1290, y: 480, width: 250, height: 160}), [90, 138, 119]);
  need(gateOutlinePixels > 300 && processorOutlinePixels > 300, 'standalone figure outlines are missing above their labels');
  const beforeInk = colorCount(crop(decoded.get(0), corridor), [23, 121, 93]);
  const afterInk = colorCount(crop(decoded.get(58), corridor), [23, 121, 93]);
  need(beforeInk < 10 && afterInk > 400, 'region fill obscures the relationship or the line appeared early');
  const original = {x: 160, y: 500, width: 360, height: 320};
  const beforeSource = crop(decoded.get(199), original), afterSource = crop(decoded.get(240), original);
  need(sha(beforeSource) === sha(afterSource), 'copy moved or rewrote original source pixels');
  const destination = {x: 980, y: 500, width: 360, height: 320};
  const beforeCopy = crop(decoded.get(199), destination), afterCopy = crop(decoded.get(240), destination);
  need(sha(beforeCopy) !== sha(afterCopy) && colors(afterCopy) > 16, 'no copied page at destination');
  const front = crop(decoded.get(240), {x: 180, y: 830, width: 40, height: 10});
  const paper = crop(decoded.get(240), {x: 180, y: 780, width: 40, height: 10});
  need(colorCount(front, [228, 244, 236]) > 360 && colorCount(paper, [252, 254, 253]) > 360,
    'tray front must physically cover the lower paper while the upper page remains visible');
  const compiled = compileEditorialMotionRenderEpisode(episode, 30);
  const before = buildEditorialMotionRenderModel(compiled, 199, 30), after = buildEditorialMotionRenderModel(compiled, 240, 30);
  need(!before.objects.some(item => item.id === 'copy') && after.objects.find(item => item.id === 'copy')?.containerId === 'input', 'source/copy membership drift');
  need(JSON.stringify(after.chapters.chapters.map(item => item.widthFraction)) === JSON.stringify([0.05, 0.95]), 'chapters must preserve the short/long scene ratio');
  const secondLabelPixels = colorCount(crop(decoded.get(240), {x: 960, y: 1020, width: 100, height: 30}), [83, 104, 94]);
  const bottomTextPixels = colorCount(crop(decoded.get(240), {x: 96, y: 1064, width: 1728, height: 16}), [83, 104, 94]);
  need(secondLabelPixels > 50, 'chapter labels must use independent equal-width slots, not short-duration track widths');
  need(bottomTextPixels === 0, 'long short-chapter labels wrapped below the fixed one-line navigation row');
  need(new Set(regions.map(item => item.chaptersSha256)).size === 4, 'chapter tracks are missing or frozen');
  return {...audit, regions, figureOutlines: {gateOutlinePixels, processorOutlinePixels},
    regionRelation: {beforeInk, afterInk, visibleAboveRegion: true},
    sourcePreserved: true, copiedPageArrived: true, trayFrontOccludesPaper: true, chaptersAudioAligned: false,
    chapterLayout: {fractions: [0.05, 0.95], secondLabelPixels, bottomTextPixels, independentLabelSlots: true},
    coverage: ['gate', 'processor', 'region', 'orthogonal-connect', 'tray', 'page-copy', 'window', 'chapters', 'global-logo']};
}

export async function runCiEditorialDiagramSmoke(rawOptions = {}) {
  const options = checkedOptions(rawOptions), episode = editorialDiagramSmokeFixture();
  const compiled = compileEditorialMotionRenderEpisode(episode, 30);
  for (const frame of EDITORIAL_DIAGRAM_SMOKE_FRAMES) buildEditorialMotionRenderModel(compiled, frame, 30);
  const browserExecutable = await resolveBrowserExecutable(null);
  need(browserExecutable, 'installed local Chrome/Chromium is required; downloads are disabled');
  const root = await mkdtemp(join(tmpdir(), 'acs-ci-editorial-diagram-'));
  const publicDirectory = resolve(root, 'public'), bundleDirectory = resolve(root, 'bundle');
  let succeeded = false;
  try {
    const assets = await copyTrackedAssets(publicDirectory);
    // Fonts are bundled from the frozen @fontsource package imported by the
    // production entry; no mutable public font/episode directory is copied.
    const serveUrl = await bundle({entryPoint: resolve(videoRoot, 'index.jsx'), outDir: bundleDirectory,
      publicDir: publicDirectory, symlinkPublicDir: false, onProgress: () => undefined});
    const inputProps = {episode};
    const browserOptions = {browserExecutable, chromeMode: 'chrome-for-testing', timeoutInMilliseconds: 120000, logLevel: 'warn'};
    const composition = await selectComposition({serveUrl, id: 'ConceptPreview', inputProps, ...browserOptions});
    const frameBuffers = [], frames = [];
    for (const frame of EDITORIAL_DIAGRAM_SMOKE_FRAMES) {
      const file = `diagram-frame-${frame}.png`, output = resolve(root, file);
      await renderStill({composition, serveUrl, inputProps, output, frame, imageFormat: 'png', overwrite: false, ...browserOptions});
      const bytes = await readFile(output);
      frameBuffers.push({frame, bytes}); frames.push({frame, file, sha256: sha(bytes), bytes: bytes.length});
    }
    const report = {kind: 'synthetic-editorial-diagram-pixel-smoke-v1',
      assurance: 'synthetic-stills-not-film-visual-acceptance', fixtureId: episode.id,
      fixtureSha256: sha(JSON.stringify(episode)), nodeVersion: process.version, browserExecutable, assets, frames,
      fontSource: 'frozen-bundled-fontsource-not-live-public-tree',
      audit: auditEditorialDiagramPixels(frameBuffers, assets, episode)};
    await writeFile(resolve(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {flag: 'wx'});
    succeeded = true;
    return {...report, ...(options.keepFrames ? {retainedDirectory: root} : {})};
  } finally {
    if (options.keepFrames && succeeded) {
      await rm(bundleDirectory, {recursive: true, force: true});
      await rm(publicDirectory, {recursive: true, force: true});
    } else await rm(root, {recursive: true, force: true});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(JSON.stringify(await runCiEditorialDiagramSmoke(parseEditorialDiagramSmokeArguments(process.argv.slice(2)))));
}
