# ADR-0125: npm Staged-Package Review Evidence

- Status: accepted
- Decision date: 2026-08-21

## Context

ADR-0124 validates an artifact's npm_cli_exit_zero but not registry stage metadata or tarball bytes. Raw stage IDs, account data, and downloads are needed transiently, not in durable reports.

## Decision

release:bootstrap:stage-review-evidence is read-only. It snapshots the stage-result report and explicit npm user config, rejects ambient credentials, and uses public registry plus npm 11.15+ in an isolated cache/config/download root. It executes only stage list, exact stage view, stage download, and a second view.

At most 100 list entries are normalized to ID, package, version, tag, time, and shasum. Both views and the list must agree; identities and raw output are discarded. Exactly one regular tarball up to 64 MiB is allowed. Its SHA-256, SHA-512 integrity, and SHA-1 shasum must match both upstream evidence and metadata. Config and stage metadata are rechecked and temporary files removed.

Report v1 proves only observation of the exact staged package and tarball. It replaces the raw stage ID with its digest and retains no account, secret, path, output, or tarball. It cannot approve, reject, perform 2FA, or publish.

## Consequences

Normalization, isolated observation, bounded sources, pure evidence, standalone validation, orchestration, and formatting remain separate. Tests cover the exact read-only sequence, cleanup, duplicate stages, races, mismatches, ambient-credential rejection, redaction, and absence of approval calls.
