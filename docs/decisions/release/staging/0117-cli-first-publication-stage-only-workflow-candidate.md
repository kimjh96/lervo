# ADR-0117: CLI First-Publication Stage-Only Workflow Candidate

- Status: accepted
- Decision date: 2026-08-21

## Context

Transition completion requires a public release, stage-only workflow, npm Trusted Publisher, and protected GitHub environment. The release workflow currently ends at `attested-cli`. Re-serializing YAML would change source bytes, blindly appending could escape `jobs`, and a candidate must not call a missing command.

## Decision

`release:bootstrap:workflow-candidate` is read-only. Its default output is human-readable; `--json` returns metadata and `--workflow-yaml` returns exact candidate bytes. Machine modes are mutually exclusive.

The reader snapshots `.github/workflows/cli-release-matrix.yml` up to 256 KiB and `package.json` up to 1 MiB, then verifies unchanged bytes. Workflow must be lossless UTF-8 LF YAML, and the manifest must be two-space JSON with a final LF. The manifest must contain the exact `release:publication:stage` script for `scripts/release/commands/stage-cli-release-publication.mjs`; otherwise fail with `first_publication_workflow_activation_stage_command_missing`.

The source must contain `attested-cli` and lack a publish command, `npm-release` environment, and `publish-cli` job. A YAML AST supplies only the end offset of the top-level `jobs` mapping. The generator inserts one fixed job and copies every other byte.

The job permits only a manual-tag condition, `attested-cli` dependency, GitHub-hosted Ubuntu, `npm-release` environment, `contents: read`, `id-token: write`, SHA-pinned actions, same-run exact release-artifact restoration, frozen installation, the exact stage command, and an always-run result-record upload for each attempt. `actions/download-artifact` v4.3.0 is pinned to `d3f86a106a0bac45b974a628896c90dbdf5c8093`. Exclude long-lived credentials, `npm publish`, npm stage publication in YAML, and cross-run or cross-repository access.

Reparse the result. All semantics except `publish-cli` must match, and the shared stage-only check must be ready. Candidate v1 binds source byte counts and hashes, insertion coordinates, output digest, limits, and absence of side effects. Return full YAML only in its dedicated mode.

The candidate is `review_required` with `writesAllowed=false`. It has no writer, observer, mutation, reservation or publisher port, runtime event, project state, or telemetry. Human output and errors omit bodies, paths, and digests.

## Consequences

Only one job changes and remains correctly nested. Missing commands and already-active workflows produce no candidate. Fixtures cover byte preservation, structure, readiness, missing prerequisites, stale snapshots, CRLF, forged authority, mutation, bounds, and output modes. They claim no activation or publication.

> [ADR-0118](0118-cli-stage-publication-command-boundary.md) implements staging records. [ADR-0119](0119-cli-stage-only-workflow-activation-permit-transaction.md) governs activation.
