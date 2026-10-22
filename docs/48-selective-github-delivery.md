# Selective GitHub delivery

Date: 2026-10-20 (Asia/Shanghai)

## Authority and scope

The user authorized selective commits and a candidate-branch push, followed by
hosted CI inspection. Creating a PR, merging to `main`, changing production gates,
rendering a new full video, or calling metered providers is not authorized.

Baseline: `0c2b1cdc993a8c9492ab5a091573d673ac60503d`.
Candidate branch: `codex/verified-system-delivery-20261020`.
This is an isolated checkout; the original dirty worktree remains untouched.

## Risk, evidence, and rollback

This is R3 delivery work across security, discovery, editorial production, and
screen presentation. The intended result is a dependency-complete, reproducible
source candidate, not a production or visual release.

Acceptance requires exact locked runtimes, frozen installation, current
production-dependency audit, focused tests, full repository verification, and
hosted CI on the pushed commit. Earlier local results do not satisfy these new
commit-bound checks. Tests must not consume the user's live episode or media.

Rollback is to leave the candidate unmerged or revert an identified candidate
commit. Never reset, clean, stash, or overwrite the original working directory.
No original media, approvals, or runtime history is to be removed.

## Selection

- Keep reusable source, deterministic tests, locked dependency patches, and
  portable operational documentation.
- Leave local collector/trend snapshots, live episodes, generated media,
  credentials, caches, local handoff notes, and episode-specific production
  plans out of the candidate.
- Shared integration files are committed with their required dependencies;
  a theme name is not permission to omit an imported module.
- Static style acceptance remains limited to its reviewed examples. It is not
  approval of a new animation or full video.

## Initial package

Dependency patches retain Remotion `4.0.504`, Node `24.19.0`, and pnpm `11.19.0`:
`fast-uri 3.1.8`, `undici 7.29.1`, `source-map-js 1.2.2`, and
`postcss-selector-parser 7.1.6`. Regression tests cover the installed versions
and targeted malformed input / connector behavior.

Delivery status when this document commit was prepared: the selected code is
locally verified. A candidate push is authorized; hosted CI must be checked on
its exact pushed SHA. PR creation and merging still require the user's next
decision. Live state is linked from `docs/STATUS.md`.

## Discovery package

The second package adds scoped public discovery, source identity and freshness
checks, explicit manual topic selection, research binding, and temporary-store
regression tests. It does not select a real topic or create a production episode.

Focused validation: 164/164 passed. The first assembly attempt incorrectly
trimmed the separate evaluation-binding-name array; seven tests rejected that
candidate. The packaging helper was corrected, the full focused group reran
successfully, and the failed version was never committed. No assertion was
relaxed and no production artifact was changed.

## Production package

The production package keeps the import/completion, timed editorial motion,
asset, local voice, private review, renderer, and screen-policy dependencies
together. It also retains the corresponding authorization, integrity, browser
ownership, path portability, and layout regressions. Existing private-review
entry points remain private review; they are not promoted to a human gate.

One visual-contract test now uses an independent, explicitly enumerated
synthetic fixture instead of the user's episode plan. The supported mechanism,
topic/outline opening, chapter ordering, and unique-ID checks remain, with
negative fixtures added. All four episode-specific plan JSON files are excluded.

Technical documents describe historical development and example commands.
Any mentioned `outputs/` evidence stays local and is not a promised GitHub link
or a test prerequisite. Fourteen episode-specific working documents are omitted.
The current delivery and gate status is only `docs/STATUS.md`.

Production-focused verification passed 118/118 tests. The v15 implementation
binding matches the source implementation; all 232 implementation paths and
all eight runtime-binding names are present. `admission.eligible` remains false.

## Static examples package

The fourth package adds the already accepted concise storyboard source,
proof command, exact font entry, documentation, and 14 passing focused tests.
No image or video was generated or accepted again in this delivery task.
The screen-policy runtime is in the production package because its consumers
already import it; this fourth package is the independently selectable examples.

## Final local verification

Code commit: `9ba00ec62b2f9d07586df81de15122646601a553`.
The subsequent delivery-record commit changes documentation only.

- Exact Node `24.19.0`, pnpm `11.19.0`, CPython `3.12.13`.
- `pnpm install --frozen-lockfile`: exit 0.
- `pnpm audit --prod --audit-level high --json`: exit 0; all severity counts 0.
- `CI=true pnpm verify`: exit 0; 1793 tests passed, no failures, skips, or
  cancellations. Includes secret scan, 429 source syntax checks, 35 motion
  assets, rollback rehearsal, three browser smoke gates, and Git diff checks.
- The former episode-plan test has one additional negative regression;
  the earlier historical 1792-test result is not being reused as current proof.
- 275 changed paths match the explicit selection. Original 1199 file hashes,
  original HEAD/branch/dirty inventory, and excluded runtime snapshots are
  unchanged. Generated media and private production state are not published.

## Review coverage and limits

Publication checks cover selection, secrets, relative imports, commands, local
documentation links, evaluation binding, and the synthetic-fixture adaptation.
OCR's final range contains 275 files: 252 reviewable source/config files and 23
tool-excluded documentation/other files. Fourteen changed files received a
focused source/diff review (5.56% of reviewable files); the other 238 are
explicitly not a repeated line-by-line audit of the previously implemented
code. The per-file checklist and command logs are retained locally.

An independent checker also verified the dependency/evaluation closure and
fixture semantics. This scope does not establish a whole-code security audit,
new full-video acceptance, or a release. Existing long-copy layout fixtures
remain stress tests, not recommended video copy.
