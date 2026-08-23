# ADR-0120: Post-Apply Verification for the Stage-Only Workflow

- Status: accepted
- Decision date: 2026-08-21

## Context

An ADR-0119 receipt canonically describes local replacement but is neither signed nor issued by a durable authority. It cannot alone prove the workflow remains unchanged or external controls remain ready. Current workflow inspection alone lacks the applied-result binding. Neither local fact proves remote GitHub deployment or execution.

## Decision

The read-only command is:

    pnpm --silent release:bootstrap:workflow-verify --repository <owner/repository> --receipt <absolute-path> --online --json

A standalone reader validates receipt v1 keys, fixed status/effects, workflow byte count and SHA-256, timestamp order, and digest. This proves self-consistency only. Source readers bound root and CLI packages to 1 MiB, workflow to 256 KiB, and receipt to 64 KiB regular files. JSON and YAML must be canonical and warning-free. Current workflow bytes must exactly match the receipt and all four files are rechecked after online observation.

The fixed transaction directory is inspected before reading and before reporting. Only absence is clear. Any directory requires recovery without interpreting its journal; symlinks, files, or inspection failures are invalid and never auto-cleaned.

Seven checks must be ready: clear transaction; receipt-matching workflow bytes; exact root stage command; ready CLI package identity/repository/license/public registry; exact full publish-cli contract; exact npm createStagedPackage trust; and GitHub npm-release required reviewer, self-review prohibition, and exact v*. The shared workflow policy validates every pinned action SHA, option, path, order, run command, and result upload.

Report v1 binds verified, local_source_and_external_controls, target, receipt/source digests, time, seven checks, and stage_only_workflow_present. It explicitly does not verify receipt issuer/signature, full candidate provenance beyond binding, remote deployment, execution, staging, or package state. Files and settings are unchanged, publication is not attempted, output is stdout only, and no runtime state or telemetry is created.

Failures distinguish invalid arguments/online boundary/source/receipt, source mismatch, pending or invalid transaction, not-ready controls, invalid report, and source races. Errors omit paths, digests, PIDs, identities, trust IDs, secrets, and raw responses.

## Consequences

Fixtures cover read-only success, forged effects/limits, byte mismatch, rehashed action changes, weakened controls, races, pending transactions, and CLI separation. No production activation, remote deployment, workflow execution, staging, approval, or publication occurred.

> Remote deployment evidence is defined by [ADR-0121](0121-cli-stage-only-workflow-remote-deployment-evidence.md).
