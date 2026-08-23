# ADR-0118: CLI Stage-Publication Command Boundary

- Status: accepted
- Decision date: 2026-08-21

## Context

The ADR-0117 candidate needs a real release:publication:stage command. This is the first persistent external write into npm staging. Boolean results or raw output cannot safely classify a lost response and may permit duplicates. Staging also differs from direct publication: maintainer review and 2FA are still required before public availability.

## Decision

The root script invokes scripts/stage-cli-release-publication.mjs and accepts only absolute release-directory, publication-authorization, and new result-directory paths.

Authorization is a regular file up to 64 KiB. The release directory may contain only the tarball, manifest, SBOM, and two attestation bundles under existing limits. Manifest, SBOM, three authorized subject hashes, and tarball SHA-256, integrity, and shasum are revalidated. Bundles join the before/after snapshot; signature verification remains owned by attested-cli.

The npm adapter requires GitHub-hosted Actions, OIDC request environment, Node 22.14+, and no long-lived registry write credential. An isolated npm 11.15+ client (repository-pinned at 11.18.0) invokes exactly once:

    npm stage publish <exact-tarball> --registry <authorized-registry> --tag <authorized-tag> --access public --ignore-scripts

Only isolated-client preparation is shared with direct publication. Records exclude stdout, stderr, OIDC tokens, credentials, paths, and stage IDs. Exit zero records exact target/artifact and evidence=npm_cli_exit_zero; it proves staging acceptance, not public availability or stage-list observation. OIDC authority is never used for list, view, approve, or reject.

Before the call, storage exclusively creates a durable mode-0700 result directory and mode-0600 attempt.json. Attempt v1 binds reserved, npm_stage_publish, authorization digest, exact target/artifact, time, and retry=forbidden_without_reconciliation. An existing directory blocks execution. Attempt alone does not prove npm started.

Exactly one terminal.json may follow:

- staged: npm exited zero and all checks and persistence succeeded; review=required_with_2fa, publicAvailability=not_claimed, retry=forbidden.
- aborted_before_stage: sources changed before npm started; retry=new_authorization_required.
- stage_outcome_unknown: an error followed process start, or receipt/source/terminal persistence failed; retry=forbidden and reconciliation=authenticated_npm_stage_review_required.

Attempt-only state also forbids blind retry. A human must inspect authenticated npm staging for the exact coordinates. There is no automatic retry, approval, rejection, public-success inference, or direct-publish fallback.

The workflow candidate uses Node 22.14, frozen install, this command, and an always-run pinned upload of attempt-specific records. Missing preflight records are a warning while the job remains failed. No workflow or external control is activated here.

Records are release operations, not runtime events, project state, or telemetry, and omit actors, reviewers, secrets, raw responses, and input paths.

## Consequences

Stage automation cannot reuse direct publication accidentally. Durable ordering and replay prohibition survive uncertain outcomes, and success is not overstated before 2FA.

Fixtures cover arguments, environment gates, one-shot behavior, isolation cleanup, subject matching, pre-call records, all terminal states, permissions, directory reuse, CLI wiring, and artifact upload. They claim no real staging, approval, publication, activation, or external mutation.

> [ADR-0119](0119-cli-stage-only-workflow-activation-permit-transaction.md) governs reviewed, recoverable workflow activation.
