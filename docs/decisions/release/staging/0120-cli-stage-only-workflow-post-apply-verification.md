# ADR-0120: Post-Apply Verification for the Stage-Only Workflow

- Status: accepted
- Decision date: 2026-08-21

## Context

An ADR-0119 receipt canonically describes local replacement but is neither signed nor issued by a durable authority. Alone, it cannot prove that the workflow remains unchanged or external controls remain ready. Current workflow inspection lacks applied-result binding. Neither local fact proves remote GitHub deployment or execution.

## Decision

The read-only command is:

    pnpm --silent release:bootstrap:workflow-verify --repository <owner/repository> --receipt <absolute-path> --online --json

A standalone reader validates receipt v1 keys, fixed status and effects, workflow byte count and SHA-256, timestamp order, and digest. This proves only self-consistency. Source readers limit the root and CLI packages to 1 MiB, the workflow to 256 KiB, and the receipt to a 64 KiB regular file. JSON and YAML must be canonical and warning-free. Current workflow bytes must exactly match the receipt, and all four files are rechecked after online observation.

The fixed transaction directory is inspected before reading and before reporting. Only absence is clear. Any directory requires recovery without interpreting its journal; symlinks, files, and inspection failures are invalid and are never auto-cleaned.

Seven checks must be ready:

- Clear transaction.
- Workflow bytes matching the receipt.
- Exact root stage command.
- Ready CLI package identity, repository, license, and public registry.
- Exact full `publish-cli` contract.
- Exact npm `createStagedPackage` trust.
- GitHub `npm-release` required reviewer, self-review prohibition, and exact `v*` policy.

The shared workflow policy validates every pinned action SHA, option, path, order, run command, and result upload.

Report v1 binds `verified`, `local_source_and_external_controls`, target, receipt/source digests, time, the seven checks, and `stage_only_workflow_present`. It explicitly does not verify the receipt issuer or signature, full candidate provenance beyond binding, remote deployment, execution, staging, or package state. Files and settings remain unchanged, publication is not attempted, output is stdout only, and no runtime state or telemetry is created.

Failures distinguish invalid arguments/online boundary/source/receipt, source mismatch, pending or invalid transaction, not-ready controls, invalid report, and source races. Errors omit paths, digests, PIDs, identities, trust IDs, secrets, and raw responses.

## Consequences

Fixtures cover read-only success, forged effects and limits, byte mismatch, rehashed action changes, weakened controls, races, pending transactions, and CLI separation. No production activation, remote deployment, workflow execution, staging, approval, or publication occurred.

> Remote deployment evidence is defined by [ADR-0121](0121-cli-stage-only-workflow-remote-deployment-evidence.md).
