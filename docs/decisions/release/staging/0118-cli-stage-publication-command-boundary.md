# ADR-0118: CLI Stage-Publication Command Boundary

- Status: accepted
- Decision date: 2026-08-21

## Context

The ADR-0117 candidate requires a real `release:publication:stage` command. A Boolean or raw-output result cannot safely classify a lost response and could permit duplicate staging. Staging is not publication: maintainer review and 2FA remain required before public availability.

## Decision

The root script invokes `scripts/release/commands/stage-cli-release-publication.mjs`. It accepts only absolute paths for the release directory, publication authorization, and new result directory.

Authorization must be a regular file no larger than 64 KiB. Under existing limits, the release directory may contain only the tarball, manifest, SBOM, and two attestation bundles. The command revalidates the manifest, SBOM, three authorized subject hashes, and the tarball's SHA-256, integrity, and shasum. Bundles participate in the before-and-after snapshot; `attested-cli` retains ownership of signature verification.

The npm adapter requires GitHub-hosted Actions, an OIDC request environment, Node 22.14+, and no long-lived registry write credential. An isolated npm 11.15+ client, pinned by the repository at 11.18.0, invokes exactly once:

    npm stage publish <exact-tarball> --registry <authorized-registry> --tag <authorized-tag> --access public --ignore-scripts

Only isolated-client preparation is shared with direct publication. Records exclude stdout, stderr, OIDC tokens, credentials, paths, and stage IDs. Exit zero records the exact target and artifact with `evidence=npm_cli_exit_zero`; this proves staging acceptance, not public availability or stage-list observation. OIDC authority is never used to list, view, approve, or reject.

Before invocation, storage exclusively creates a durable mode-0700 result directory and mode-0600 `attempt.json`. Attempt v1 binds `reserved`, `npm_stage_publish`, the authorization digest, exact target and artifact, time, and `retry=forbidden_without_reconciliation`. An existing directory blocks execution. The attempt alone does not prove npm started.

At most one `terminal.json` may follow:

- `staged`: npm exited zero and all checks and persistence succeeded; `review=required_with_2fa`, `publicAvailability=not_claimed`, and `retry=forbidden`.
- `aborted_before_stage`: sources changed before npm started; `retry=new_authorization_required`.
- `stage_outcome_unknown`: an error occurred after process start, or receipt, source, or terminal persistence failed; `retry=forbidden` and `reconciliation=authenticated_npm_stage_review_required`.

Attempt-only state also prohibits blind retry. A human must inspect authenticated npm staging for the exact coordinates. There is no automatic retry, approval, rejection, inference of public success, or direct-publication fallback.

The workflow candidate uses Node 22.14, a frozen install, this command, and an always-run pinned upload of attempt-specific records. Missing preflight records produce a warning while the job remains failed. This decision activates no workflow or external control.

Records are release operations, not runtime events, project state, or telemetry, and omit actors, reviewers, secrets, raw responses, and input paths.

## Consequences

Stage automation cannot accidentally reuse direct publication. Durable ordering and replay prohibition survive uncertain outcomes, while success is not overstated before 2FA.

Fixtures cover arguments, environment gates, one-shot behavior, isolation cleanup, subject matching, pre-call records, every terminal state, permissions, directory reuse, CLI wiring, and artifact upload. They claim no real staging, approval, publication, activation, or external mutation.

> [ADR-0119](0119-cli-stage-only-workflow-activation-permit-transaction.md) governs reviewed, recoverable workflow activation.
