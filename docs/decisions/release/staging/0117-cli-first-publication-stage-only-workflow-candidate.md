# ADR-0117: CLI First-Publication Stage-Only Workflow Candidate

- Status: accepted
- Decision date: 2026-08-21

## Context

Transition completion requires a public release, stage-only workflow, npm Trusted Publisher, and protected GitHub environment. The release workflow currently ends at `attested-cli`. Re-serializing YAML would alter source bytes, blind appending could escape `jobs`, and a candidate must not invoke a missing command.

## Decision

`release:bootstrap:workflow-candidate` is read-only. Its default output is human-readable; `--json` returns metadata, and `--workflow-yaml` returns exact candidate bytes. Machine modes are mutually exclusive.

The reader snapshots `.github/workflows/cli-release-matrix.yml` up to 256 KiB and `package.json` up to 1 MiB, then verifies their bytes remain unchanged. The workflow must be lossless UTF-8 LF YAML. The manifest must be two-space JSON ending with LF and contain the exact `release:publication:stage` script for `scripts/release/commands/stage-cli-release-publication.mjs`; otherwise, fail with `first_publication_workflow_activation_stage_command_missing`.

The source must contain `attested-cli` and contain no publish command, `npm-release` environment, or `publish-cli` job. A YAML AST supplies only the top-level `jobs` mapping's end offset. The generator inserts one fixed job and copies every other byte.

The job permits only:

- a manual-tag condition;
- an `attested-cli` dependency;
- GitHub-hosted Ubuntu;
- the `npm-release` environment;
- `contents: read` and `id-token: write`;
- SHA-pinned actions;
- same-run, exact release-artifact restoration;
- frozen installation;
- the exact stage command; and
- an always-run result-record upload for every attempt.

`actions/download-artifact` v4.3.0 is pinned to `d3f86a106a0bac45b974a628896c90dbdf5c8093`. Long-lived credentials, `npm publish`, npm stage publication in YAML, and cross-run or cross-repository access are prohibited.

Reparse the result. All semantics except `publish-cli` must match, and the shared stage-only check must be ready. Candidate v1 binds source byte counts and hashes, insertion coordinates, output digest, limits, and absence of side effects. Full YAML is returned only by its dedicated mode.

The candidate is `review_required` with `writesAllowed=false`. It has no writer, observer, mutation, reservation or publisher port, runtime event, project state, or telemetry. Human output and errors omit bodies, paths, and digests.

## Consequences

Exactly one job changes and remains correctly nested. A missing command or already-active workflow produces no candidate. Fixtures cover byte preservation, structure, readiness, missing prerequisites, stale snapshots, CRLF, forged authority, mutation, bounds, and output modes. They claim neither activation nor publication.

> [ADR-0118](0118-cli-stage-publication-command-boundary.md) implements staging records. [ADR-0119](0119-cli-stage-only-workflow-activation-permit-transaction.md) governs activation.
