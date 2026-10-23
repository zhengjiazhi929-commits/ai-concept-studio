import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  validateLocalResearchPreview,
  validateLocalResearchRequest,
  localResearchCapabilitySpec
} from '../src/shared/local-research-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';

const flags = new Map([
  ['--episode', 'episodeId'], ['--action', 'action'], ['--candidate', 'candidatePath'],
  ['--research-version', 'researchVersion'], ['--snapshot', 'snapshotHash'],
  ['--actor', 'actor'], ['--reason', 'reason'], ['--batch-id', 'batchId'],
  ['--candidate-sha256', 'candidateSha256']
]);
const executionFields = ['researchVersion', 'snapshotHash', 'actor', 'reason'];
const cliError = code => Object.assign(new Error('本地研究参数无效'), {code});

export function parseLocalResearchArguments(argv) {
  const invalid = () => cliError('local_research_arguments_invalid');
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) throw invalid();
  const args = [...argv];
  if (args[0] === '--') args.shift();
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--confirm-local-research') {
      if (Object.hasOwn(values, 'confirmLocalResearch')) throw invalid();
      values.confirmLocalResearch = true;
      continue;
    }
    const key = flags.get(flag);
    if (!key || Object.hasOwn(values, key)) throw invalid();
    const value = args[++index];
    if (!value || !value.trim() || value.startsWith('-') || /\p{Cc}/u.test(value)) throw invalid();
    if (key === 'researchVersion' && !/^(0|[1-9][0-9]*)$/u.test(value)) throw invalid();
    values[key] = key === 'researchVersion' ? Number(value) : value;
  }
  if (!values.episodeId || !['run', 'import'].includes(values.action)) throw invalid();
  const isImport = values.action === 'import';
  if (isImport && !Object.hasOwn(values, 'candidatePath')) throw invalid();
  if (!isImport && ['candidatePath', 'batchId', 'candidateSha256'].some(key => Object.hasOwn(values, key))) throw invalid();
  const preview = {
    episodeId: values.episodeId,
    action: values.action,
    candidatePath: isImport ? values.candidatePath : null
  };
  if (Object.keys(values).length === (isImport ? 3 : 2)) {
    return Object.freeze({mode: 'preview', request: Object.freeze(validateLocalResearchPreview(preview))});
  }
  if (!values.confirmLocalResearch || executionFields.some(key => !Object.hasOwn(values, key)) ||
    (isImport && ['batchId', 'candidateSha256'].some(key => !Object.hasOwn(values, key)))) throw invalid();
  const request = {
    ...preview,
    researchVersion: values.researchVersion,
    snapshotHash: values.snapshotHash,
    actor: values.actor,
    reason: values.reason,
    batchId: isImport ? values.batchId : null,
    candidateSha256: isImport ? values.candidateSha256 : null,
    confirmLocalResearch: true
  };
  return Object.freeze({mode: 'execute', request: Object.freeze(validateLocalResearchRequest(request))});
}

export async function runLocalResearchCli(argv = process.argv.slice(2), dependencies = {}) {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(dependencies)) ||
    Reflect.ownKeys(dependencies).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
      return !['preview', 'execute'].includes(key) || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function';
    })) throw cliError('local_research_dependencies_invalid');
  const parsed = parseLocalResearchArguments(argv);
  if (parsed.mode === 'preview') {
    const preview = dependencies.preview ??
      (await import('../src/server/research/local-research.mjs')).previewLocalResearch;
    return {ok: true, mode: 'preview', preview: await preview(parsed.request)};
  }
  // A fresh OS-local declaration, not a login session or a human Gate approval.
  // The sealed production wrapper binds the snapshot and restricts actual sinks.
  const authority = createCapabilityAuthority({
    secret: randomBytes(32).toString('hex'), defaultTtlMs: 300000, maximumTtlMs: 300000,
    maximumCalls: 0, maximumCostUsd: 0
  });
  const sideEffectGrant = authority.authorize(localResearchCapabilitySpec(parsed.request));
  const execute = dependencies.execute ??
    (await import('../src/server/research/local-research.mjs')).executeLocalResearch;
  return {ok: true, mode: 'executed', result: await execute(parsed.request, Object.freeze({sideEffectGrant}))};
}

export async function reportLocalResearchCli(run = () => runLocalResearchCli()) {
  try {
    console.log(JSON.stringify(await run(), null, 2));
  } catch (error) {
    const codes = new Set([
      'local_research_arguments_invalid', 'local_research_dependencies_invalid',
      'local_research_request_invalid', 'local_research_options_invalid',
      'local_research_episode_invalid', 'local_research_episode_busy',
      'local_research_episode_mismatch', 'local_research_already_approved',
      'local_research_snapshot_changed', 'local_research_version_changed',
      'local_research_candidate_invalid', 'local_research_candidate_changed',
      'local_research_candidate_missing', 'local_research_batch_changed',
      'local_research_binding_invalid', 'local_research_binding_changed',
      'local_research_capability_not_zero', 'local_research_sink_forbidden',
      'local_research_budget_forbidden', 'local_research_scope_forbidden',
      'local_research_paid_review_forbidden', 'local_research_evidence_changed',
      'local_research_dispatch_required', 'local_research_dispatch_mismatch',
      'local_research_dispatch_replayed',
      'episode_operation_active',
      'local_research_action_forbidden', 'local_research_transition_invalid',
      'local_research_conflict', 'local_research_semantic_review_forbidden',
      'research_batch_id_conflict', 'research_pack_episode_mismatch',
      'side_effect_capability_missing', 'side_effect_capability_expired'
    ]);
    console.error(JSON.stringify({
      ok: false,
      code: codes.has(error?.code) ? error.code : 'local_research_cli_failed',
      message: '本地研究未完成，请重新核对当前任务、证据批次与预览快照；不会自动批准研究或扩大预算。'
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportLocalResearchCli();
