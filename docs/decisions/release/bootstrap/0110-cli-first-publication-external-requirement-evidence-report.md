# ADR-0110: CLI first-publication external-requirement evidence report

Status: `accepted`
Decision date: 2026-08-21

## Context

Post-apply verifies local consistency but leaves license approval, public-name availability, npm scope control, and complete first-publication approval. Those require separate replaceable/expiring sources, not ever-growing fields in one approval.

## Decision

Maintain separate JSON documents for license approval, npm scope-control confirmation, and existing first-publication approval; obtain public availability only through explicit online observation. The report binds them without arming or publication authority.

### Evidence sources

- License approval v1 records exact package/repository/license/post-apply digest, human user actor, time, decision `approve_public_distribution_license`, and `operator_attestation`. It states a human decision, not authenticated identity or externally verified legal judgment.
- Scope confirmation v1 records package, organization/user owner `lervo`, post-apply digest, user actor, confirmation time and ≤24-hour expiry, decision `confirm_npm_scope_control`, and operator attestation. It is not registry proof.
- First-publication approval must match publication digest/license/scope and approve license, name, scope, one-time direct publish, and subsequent stage-only transition.

`release:bootstrap:external-evidence` requires absolute receipt, post-apply report, publication authorization, license approval, scope confirmation, first-publication approval, explicit online, and JSON.

Read five explicit canonical ≤64-KiB regular JSON snapshots; post-apply verifier separately reads receipt plus current package/release/SBOM/lockfile. Reconstruct current post-apply and match stored report, validate people-doc formats/times/targets/authorization, then and only then call anonymous npm once. After observation reconstruct post-apply again and verify all five input bytes unchanged before returning.

Accept exact public 404 only; 2xx means unavailable name, other/network means unavailable observation. Never infer private-package absence.

Report v1 binds `evidence_bound`, activation not implemented, arming not armed; complete target; receipt/post-apply/publication/artifact/source coordinates; evidence IDs/digests/times; public observation with ten-minute expiry; all four requirements bound; earliest overall expiry; and no effects.

`bound` means same-target source linkage, not machine-verified authority or execution permission. Explicit limitations: receipt issuer/signature unverified, human actors unauthenticated, scope not registry-verified, private absence unknown, and release bytes not reverified by this command.

Actor IDs stay input-only. JSON may expose nonsecret evidence coordinates/times; human output hides IDs/digests. Exclude credentials, npm bodies/errors, file bodies/paths. Write/change/create/publish nothing and emit no event.

Failures distinguish arguments/source/post-apply/license/scope/target/observation/package/report plus upstream errors, all source-free.

## Consequences

Four external requirements have independent, expiring evidence while activation remains closed. ADR-0111 makes this report bootstrap v2 input.
