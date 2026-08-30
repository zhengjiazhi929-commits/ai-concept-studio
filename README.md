# AI Concept Studio

AI Concept Studio is a reviewable production system that turns emerging AI
technical concepts into accurate, evidence-backed videos designed to support
product decisions.

Target videos run 8–12 minutes. The current `golden-001`
M1 is a 36-second local, internal technical sample used to validate the
production and approval loop; it is not a long-form delivery.

> [`docs/STATUS.md`](./docs/STATUS.md) is the only source of truth for current
> implementation, verification, approval, merge, and release status. This
> README explains the system but does not constitute acceptance evidence.

## What the System Does

The project is designed to:

- identify emerging or rapidly developing AI technical concepts;
- separate market signals from factual evidence;
- build research, scripts, storyboards, assets, voice, and final-video
  candidates as versioned artifacts;
- keep five human approval gates in the production workflow;
- render local video candidates and run technical QA;
- preserve evidence, audit history, rollback paths, and fixed fallback
  behavior.

It is not an automated news-reposting system, an autonomous publisher, or a
mechanism for models to approve their own output.

## Current Maturity and Safety Boundary

The repository contains a controlled local AI-agent prototype with completed core
security, recovery, asset-rights, CI, and governance remediation. This does not
mean that `assisted` or `active` mode has been approved for use, that a business
gate has been approved, or that a product or open-source release has occurred.

Models and agents may propose bounded actions. They may not approve a human
gate, rewrite history, bypass evidence, enlarge their own capabilities or
budget, or publish automatically.

The runnable system is located in [`studio/`](./studio/). It can produce a
local MP4 from a structured storyboard and run technical QA. Whether
`golden-001` currently has an acceptable final video must be determined from
its Episode state and [`docs/STATUS.md`](./docs/STATUS.md), never from the
presence of an output file alone.

## Local Setup and Verification

The project pins Node.js `24.19.0` and pnpm `11.19.0`.

From [`studio/`](./studio/), run:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --prod --audit-level high
```

`pnpm verify` uses tracked fixtures and injected temporary data roots. It
covers secret scanning, JS/JSX/TS/TSX syntax, the motion library, the full test
suite, rollback rehearsal, and a fixed local render smoke test.

The verification command does not call a real model or paid provider, read or
write the live Episode, or advance a human gate.

## Run the Local Console

From [`studio/`](./studio/), run:

```bash
pnpm start:open
```

Platform launchers are also available:

- [Windows launcher](./studio/%E5%90%AF%E5%8A%A8AI%E8%A7%86%E9%A2%91%E7%B3%BB%E7%BB%9F.cmd)
- [macOS launcher](./studio/%E5%90%AF%E5%8A%A8AI%E8%A7%86%E9%A2%91%E7%B3%BB%E7%BB%9F.command)

## Repository Map

- [`docs/01-content-contract.md`](./docs/01-content-contract.md): channel
  positioning, audience, content depth, and communication standards
- [`docs/02-quality-rubric.md`](./docs/02-quality-rubric.md): shared quality
  rubric for topics, scripts, and final videos
- [`docs/03-topic-selection-rules.md`](./docs/03-topic-selection-rules.md):
  admission rules for the golden sample and routine topic selection
- [`docs/04-golden-sample-process.md`](./docs/04-golden-sample-process.md):
  human-orchestrated process for the first golden sample
- [`docs/05-visual-system.md`](./docs/05-visual-system.md): 16:9 desktop
  master, 9:16 adaptation, safe areas, captions, diagrams, transitions, and
  reusable components
- [`docs/06-agent-architecture-v2.md`](./docs/06-agent-architecture-v2.md):
  hybrid Main Agent, model routing, review coordination, migration stages, and
  file-level implementation map
- [`docs/07-motion-library.md`](./docs/07-motion-library.md): curated
  landscape-video motion library, GIF previews, and Remotion usage
- [`docs/08-visual-expression-contract.md`](./docs/08-visual-expression-contract.md):
  executable semantic, composition, and rendered-frame QA contract for video
  visuals
- [`docs/08-development-governance.md`](./docs/08-development-governance.md):
  adopted development, verification, evaluation, and delivery process
- [`docs/09-ai-tech-icon-system.md`](./docs/09-ai-tech-icon-system.md):
  approved semantic icon registry, geometry, usage boundaries, and motion
  contract for AI technical videos
- [`docs/STATUS.md`](./docs/STATUS.md): the only current-state source for
  verification, blockers, approvals, merge state, and the next admission gate
- [`research/2026-07-30-golden-topic-candidates.md`](./research/2026-07-30-golden-topic-candidates.md):
  withdrawn novelty-first candidates retained for audit history
- [`research/2026-07-30-creator-heat-audit.md`](./research/2026-07-30-creator-heat-audit.md):
  recent creator and event signal audit
- [`research/2026-07-31-hot-concept-candidates.md`](./research/2026-07-31-hot-concept-candidates.md):
  concept candidates derived from market signals and the current basis for
  topic selection
- [`research/2026-07-31-agentic-coding-evidence-pack.md`](./research/2026-07-31-agentic-coding-evidence-pack.md):
  primary-source evidence pack for golden sample 001
- [`episodes/golden-001/`](./episodes/golden-001/): the Agentic Coding golden
  sample; historical creative directions are not current approval evidence
- [`demo/agentic-coding-saas/`](./demo/agentic-coding-saas/): locally
  reproducible SaaS task with synthetic data for recording failing tests,
  fixes, diffs, and browser acceptance

## Production Workflow

```text
Trend discovery
→ Topic planning
→ Research and evidence verification
→ Human research approval
→ Outline and script
→ Human script approval
→ Storyboard
→ Human storyboard approval
→ Assets and voice
→ Human assets and voice approval
→ Video composition and QA
→ Human final-video approval
→ Publishing review and retrospective
```

## Operating Principles

1. Competitor content is a market signal, not a factual source.
2. Important technical claims must trace back to official announcements,
   documentation, papers, model cards, or official repositories.
3. Agents accelerate work; humans retain topic selection and the five
   production approvals: research, script, storyboard, assets and voice, and
   final video.
4. The golden sample is the regression standard for new agents and video
   templates. Add one verifiable module at a time.
5. The initial version will not publish automatically or scrape creator content
   in bulk without authorization.
6. Network, model, filesystem, and paid side effects require explicit,
   server-issued capabilities and fail closed when authorization is missing.
7. Interrupted provider calls remain ambiguous until reconciled; they are
   never silently treated as zero-use or retried automatically.

## Golden Sample and Local M1

The local M1 validates the production contract before long-form delivery:

- `golden-001` is a 36-second, six-section internal technical sample;
- the long-form `07-script.md` and `08-storyboard.md` are reference material,
  not proof of the current M1 artifact or gate state;
- four synthetic-data product screenshots are registered with byte counts and
  SHA-256 digests;
- the local console, Workflow Kernel, five human gates, machine review,
  interruption recovery, and versioned rendering code are implemented;
- M1 media work is restricted to local offline capability and fixed inputs
  unless a paid call is separately authorized;
- earlier `v001` voice and dossier artifacts predate the current binding
  checks and are historical only;
- videos produced by historical commits or other worktrees cannot be presented
  as the current Episode result;
- rendering requires approval at the current Assets/Voice gate, and release
  claims require QA of the current MP4 plus the final human gate.

Current gate state, valid bindings, and available artifacts must always be read
from the Episode and [`docs/STATUS.md`](./docs/STATUS.md).

The product requirements, scope, and delivery sequence are documented in
[`docs/PRD.md`](./docs/PRD.md), [`docs/scope.md`](./docs/scope.md), and
[`docs/m1-roadmap.md`](./docs/m1-roadmap.md).

## License and Release Status

No project-level open-source license has been granted yet. Do not infer a
license from the repository being publicly accessible. See
[`docs/licensing.md`](./docs/licensing.md) for asset and dependency licensing
rules, and [`docs/STATUS.md`](./docs/STATUS.md) for current release blockers.

## Optional Backup

The repository supports layered Git and OneDrive backup, but support does not
prove that backup is configured or current. Connection state, last successful
backup time, and coverage must be verified in the local console or
[`docs/STATUS.md`](./docs/STATUS.md). The local M1 does not depend on
OneDrive.

To enable media backup, copy the platform-appropriate example configuration:

- Windows: `studio/config/cloud-backup.example.json`
- macOS: `studio/config/cloud-backup.macos.example.json`

Save it as the untracked file `studio/config/cloud-backup.local.json`, set
`mediaRoot`, then run:

```bash
pnpm cloud:status
pnpm cloud:backup
```

The operator must explicitly start a backup. API keys, cookies, dependencies,
and temporary files must never be uploaded.
