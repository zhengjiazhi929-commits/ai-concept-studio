import assert from 'node:assert/strict';
import test from 'node:test';
import { CI_EDITORIAL_MOTION_FRAMES, CI_EDITORIAL_WATERMARK_FRAMES, parseEditorialSmokeArguments }
  from '../scripts/ci-editorial-motion-smoke.mjs';
import { editorialMotionRendererFixture } from './editorial-motion-renderer-fixture.mjs';
import { validateEditorialMotionPlan } from '../src/shared/editorial-motion.mjs';

test('editorial smoke covers pre-copy, movement, inclusion and temporary override', () => {
  assert.deepEqual(CI_EDITORIAL_MOTION_FRAMES, [19, 40, 50, 60, 90]);
  assert.deepEqual(CI_EDITORIAL_WATERMARK_FRAMES, [0, 19, 40, 50, 60, 90]);
  const fixture = editorialMotionRendererFixture();
  assert.equal(fixture.id, 'synthetic-editorial-renderer');
  assert.deepEqual(validateEditorialMotionPlan(fixture.scenes[0].motionPlan, {
    narration: fixture.scenes[0].narration, durationInFrames: 180,
  }), { valid: true, errors: [] });
});

test('the smoke command accepts no live input or arbitrary public directory', () => {
  assert.deepEqual(parseEditorialSmokeArguments([]), { keepFrames: false });
  assert.deepEqual(parseEditorialSmokeArguments(['--keep-frames']), { keepFrames: true });
  for (const args of [['--episode', 'live'], ['--public-dir', '/tmp'], ['--keep-frames', '--keep-frames']]) {
    assert.throws(() => parseEditorialSmokeArguments(args));
  }
});
