# ADR-0110: CLI first-publication external-requirement evidence report

Status: `accepted`
Decision date: 2026-08-21

## Context

Post-apply verification establishes local consistency but does not satisfy license approval, public-name availability, npm scope control, or complete first-publication approval. These require separate, replaceable, expiring sources rather than accumulating fields in one approval.

## Decision

Maintain separate JSON documents for license approval, npm scope-control confirmation, and existing first-publication approval. Obtain public availability only through an explicit online observation. Bind these sources in a report that grants neither arming nor publication authority.

### Evidence sources

- License approval v1 records the exact package, repository, license, and post-apply digest; a human user actor; time; decision `approve_public_distribution_license`; and `operator_attestation`. It records a human decision, not authenticated identity or an externally verified legal judgment.
- Scope confirmation v1 records the package; organization/user owner `lervo`; post-apply digest; user actor; confirmation time and expiry of at most 24 hours; decision `confirm_npm_scope_control`; and operator attestation. It is not registry proof.
- First-publication approval must match the publication digest, license, and scope, and approve the license, name, scope, one-time direct publish, and subsequent stage-only transition.

`release:bootstrap:external-evidence` requires an absolute receipt, post-apply report, publication authorization, license approval, scope confirmation, first-publication approval, explicit online access, and JSON output.

Read five explicit canonical regular JSON snapshots, each no larger than 64 KiB. The post-apply verifier separately reads the receipt and current package, release manifest, SBOM, and lockfile. Reconstruct the current post-apply result and match the stored report. Validate document formats, times, targets, people records, and authorization. Only then make one anonymous npm call. After observation, reconstruct post-apply again and verify that all five input byte sequences remain unchanged.

Accept only an exact public 404. A 2xx response means the name is unavailable; any other response or network failure means availability could not be observed. Never infer absence of a private package.

Report v1 binds `evidence_bound`, activation as unimplemented, arming as not armed, the complete target, receipt/post-apply/publication/artifact/source coordinates, evidence IDs/digests/times, a public observation expiring after ten minutes, all four bound requirements, the earliest overall expiry, and no effects.

`bound` means same-target source linkage, not machine-verified authority or execution permission. State these limitations explicitly: receipt issuer/signature unverified, human actors unauthenticated, scope not registry-verified, private absence unknown, and release bytes not reverified by this command.

Actor IDs remain input-only. JSON may expose nonsecret evidence coordinates and times; human output hides IDs and digests. Exclude credentials, npm bodies/errors, file bodies, and paths. Do not write, change, create, publish, or emit events.

Failures distinguish arguments, source, post-apply, license, scope, target, observation, package, and report errors, plus upstream errors, without exposing source material.

## Consequences

The four external requirements have independent, expiring evidence while activation remains closed. ADR-0111 uses this report as bootstrap v2 input.
