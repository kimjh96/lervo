# ADR-0121: Remote Deployment Evidence for the Stage-Only Workflow

- Status: accepted
- Decision date: 2026-08-21

## Context

ADR-0120 proves only current local workflow bytes and freshly observed controls. It does not prove those bytes exist in GitHub at a particular commit. Reading only a remote path likewise fails to bind verified local bytes and a reviewed repository; movable branches or tags are insufficient. File presence does not prove reachability, execution, staging, or publication.

## Decision

The read-only command is:

    pnpm --silent release:bootstrap:workflow-remote-evidence --repository <owner/repository> --source-commit <40-character-lowercase-sha> --post-apply-report <absolute-path> --online --json

The reader snapshots current workflow up to 256 KiB and canonical post-apply report up to 64 KiB. A standalone reader validates report keys, fixed status/limits/effects, times, and digest. Current workflow SHA-256 must match the report; warning-free UTF-8 LF YAML must pass the full shared stage-only policy. Both sources are rechecked after observation, and the activation transaction must be absent before reading and before reporting.

An authenticated gh api GET reads only:

    repos/<owner/repository>/contents/.github/workflows/cli-release-matrix.yml?ref=<source-commit>

The response must be a base64 file at the exact path, 1–256 KiB, with a 40-character blob SHA. Strict decoding, declared size, byte count, SHA-256, exact local-byte equality, and the stage-only policy are all verified. The observer has no mutation, dispatch, or publication port. Failures normalize to bounded unavailable reasons without retaining credentials or raw responses.

Evidence v1 binds evidence_bound, first_publication_stage_only_workflow_remote_source, repository, source commit, fixed path, package/environment, post-apply report digest, local SHA-256, remote blob SHA/size/SHA-256, and observation time. It proves only exact_workflow_present_at_source_commit.

It explicitly does not authenticate the stored local report's issuer, prove reachability from default branch or release tags, or observe execution, staging, 2FA, or publication. Files and GitHub settings remain unchanged; dispatch and publication are not attempted; output is stdout only; no runtime state or telemetry is created.

Failures distinguish invalid arguments, online/source/input/binding, pending or invalid transaction, not-ready observation, invalid normalized observation, byte mismatch, invalid report, and source races. Errors omit paths, digests, PIDs, identities, trust IDs, secrets, and raw GitHub responses.

## Consequences

GitHub access, source reading, pure binding, standalone validation, orchestration, and formatting remain separate. Fixtures cover exact GET coordinates, encoding/size/path bounds, read-only success, repository/commit/byte mismatch, forged authority, action changes, races, transaction states, and CLI privilege separation. No production deployment or external execution occurred.

> Ref reachability is handled by [ADR-0122](0122-cli-stage-only-workflow-ref-reachability-evidence.md).
