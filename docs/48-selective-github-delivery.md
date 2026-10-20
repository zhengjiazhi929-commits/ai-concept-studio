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

Current delivery status: candidate assembly in progress; no hosted result for
this candidate, no PR, and no merge.
