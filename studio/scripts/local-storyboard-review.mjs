import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateLocalStoryboardReviewPreview, validateLocalStoryboardReviewRequest, localStoryboardReviewCapabilitySpec} from '../src/shared/local-storyboard-review-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';

const flags = new Map([
  ['--episode', 'episodeId'], ['--storyboard-version', 'storyboardVersion'], ['--artifact-hash', 'artifactHash'],
  ['--snapshot', 'snapshotHash'], ['--actor', 'actor'], ['--reason', 'reason']
]);
const executionFields = ['storyboardVersion', 'artifactHash', 'snapshotHash', 'actor', 'reason'];
const cliError = code => Object.assign(new Error('本地分镜审核参数无效'), {code});

export function parseLocalStoryboardReviewArguments(argv) {
  const invalid = () => cliError('local_storyboard_review_arguments_invalid');
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) throw invalid();
  const args = [...argv];
  if (args[0] === '--') args.shift();
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--confirm-local-storyboard-review') {
      if (Object.hasOwn(values, 'confirmLocalStoryboardReview')) throw invalid();
      values.confirmLocalStoryboardReview = true;
      continue;
    }
    const key = flags.get(flag);
    if (!key || Object.hasOwn(values, key)) throw invalid();
    const value = args[++index];
    if (!value || !value.trim() || value.startsWith('-') || /\p{Cc}/u.test(value)) throw invalid();
    if (key === 'storyboardVersion' && !/^[1-9][0-9]*$/u.test(value)) throw invalid();
    values[key] = key === 'storyboardVersion' ? Number(value) : value;
  }
  if (!values.episodeId) throw invalid();
  if (Object.keys(values).length === 1) {
    return Object.freeze({mode: 'preview', request: Object.freeze(validateLocalStoryboardReviewPreview(values))});
  }
  if (!values.confirmLocalStoryboardReview || executionFields.some(key => !Object.hasOwn(values, key))) throw invalid();
  return Object.freeze({mode: 'execute', request: Object.freeze(validateLocalStoryboardReviewRequest(values))});
}

export async function runLocalStoryboardReviewCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(dependencies)) ||
    Reflect.ownKeys(dependencies).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
      return !['preview', 'execute'].includes(key) || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function';
    })) throw cliError('local_storyboard_review_dependencies_invalid');
  const parsed = parseLocalStoryboardReviewArguments(argv);
  if (parsed.mode === 'preview') {
    const preview = dependencies.preview ??
      (await import('../src/server/reviews/local-storyboard-review.mjs')).previewLocalStoryboardReview;
    return {ok: true, mode: 'preview', preview: await preview(parsed.request)};
  }
  // This local, one-process declaration cannot authorize a human Gate or Provider.
  const authority = createCapabilityAuthority({secret: randomBytes(32).toString('hex'),
    defaultTtlMs: 300000, maximumTtlMs: 300000, maximumCalls: 0, maximumCostUsd: 0});
  const sideEffectGrant = authority.authorize(localStoryboardReviewCapabilitySpec(parsed.request));
  const execute = dependencies.execute ??
    (await import('../src/server/reviews/local-storyboard-review.mjs')).executeLocalStoryboardReview;
  return {ok: true, mode: 'executed', result: await execute(parsed.request, Object.freeze({sideEffectGrant}))};
}

export async function reportLocalStoryboardReviewCli(run = () => runLocalStoryboardReviewCli()) {
  try {
    console.log(JSON.stringify(await run(), null, 2));
  } catch (error) {
    const codes = new Set([
      'local_storyboard_review_arguments_invalid', 'local_storyboard_review_dependencies_invalid',
      'local_storyboard_review_request_invalid', 'local_storyboard_review_options_invalid',
      'local_storyboard_review_episode_invalid', 'local_storyboard_review_episode_busy',
      'local_storyboard_review_input_invalid', 'local_storyboard_review_not_pending', 'local_storyboard_review_not_deterministic',
      'local_storyboard_review_already_approved', 'local_storyboard_review_state_invalid',
      'local_storyboard_review_snapshot_changed', 'local_storyboard_review_version_changed',
      'local_storyboard_review_artifact_changed', 'local_storyboard_review_binding_invalid',
      'local_storyboard_review_binding_changed', 'local_storyboard_review_source_changed',
      'local_storyboard_review_script_changed', 'local_storyboard_review_manifest_changed',
      'local_storyboard_review_storyboard_changed', 'local_storyboard_review_timeline_changed',
      'local_storyboard_review_script_not_approved', 'local_storyboard_review_script_binding_changed',
      'local_storyboard_review_evidence_unregistered', 'local_storyboard_review_evidence_changed',
      'local_storyboard_review_source_unregistered', 'local_storyboard_review_source_incomplete',
      'local_storyboard_review_research_not_approved', 'local_storyboard_review_research_binding_changed',
      'local_storyboard_review_config_invalid', 'local_storyboard_review_implementation_invalid',
      'local_storyboard_review_paid_review_forbidden', 'local_storyboard_review_semantic_review_forbidden',
      'local_storyboard_review_capability_not_zero', 'local_storyboard_review_sink_forbidden',
      'local_storyboard_review_budget_forbidden', 'local_storyboard_review_scope_forbidden',
      'local_storyboard_review_dispatch_required', 'local_storyboard_review_conflict',
      'local_storyboard_review_request_required',
      'episode_operation_active', 'episode_state_conflict',
      'side_effect_capability_missing', 'side_effect_capability_expired',
      'side_effect_capability_episode_mismatch', 'side_effect_capability_operation_mismatch',
      'side_effect_capability_scope_mismatch',
      'approved_script_episode_invalid', 'approved_script_binding_invalid', 'approved_script_not_approved',
      'approved_script_review_changed', 'approved_script_evidence_changed', 'approved_script_source_unregistered',
      'local_storyboard_file_invalid', 'local_storyboard_candidate_invalid', 'local_storyboard_script_binding_changed',
      'local_storyboard_narration_changed', 'local_storyboard_source_unit_changed', 'local_storyboard_evidence_invalid',
      'local_storyboard_cue_invalid', 'local_storyboard_timing_invalid', 'local_storyboard_coverage_invalid'
    ]);
    console.error(JSON.stringify({ok: false,
      code: codes.has(error?.code) ? error.code : 'local_storyboard_review_cli_failed',
      message: '本地分镜审核未完成，请核对当前版本、证据与预览快照；不会自动批准分镜、扩预算或继续制作。'}));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportLocalStoryboardReviewCli();
