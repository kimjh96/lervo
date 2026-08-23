# ADR-0124: npm Stage-Result Artifact Evidence

- Status: accepted
- Decision date: 2026-08-21

## Context

ADR-0123 proves an exact successful Actions attempt and artifact metadata, not the immutable stage attempt and terminal inside the artifact. Artifact ZIP downloads introduce redirect, replacement, bomb, traversal, symlink, and duplicate-entry risks. An embedded npm exit-zero record is still not an independent registry observation or 2FA proof.

## Decision

The read-only stage-result-evidence command requires exact repository, source SHA, release tag, run ID, attempt, absolute execution report, --online, and optional --json.

It validates canonical execution evidence up to 128 KiB, requires exact target equality, and rechecks it after observation. The GitHub adapter reads bound artifact metadata up to 256 KiB and requires exact name, run, source, size, hash, expiry, and timestamps. Artifacts over 1 MiB are not downloaded. The exact artifact ZIP endpoint is read into at most 1 MiB of memory; byte count and SHA-256 must match before metadata is re-read. Changed or expired artifacts fail. Redirect URLs, identities, and raw responses are discarded.

The ZIP reader first checks archive digest and permits only single-disk, non-ZIP64 archives. It validates central/local headers, stored or deflate methods, flags, CRC-32, sizes, descriptors, contiguous records, and rejects comments or trailing bytes. Exactly two regular entries—attempt.json and terminal.json—are allowed. Duplicates, directories, symlinks, unsafe names, and entries over 128 KiB are rejected. Decompressed canonical JSON never reaches the filesystem.

The standalone validator recomputes attempt/terminal digests, authorization digest, target/artifact, times, and retry disposition. Terminal must exactly report staged, npm_stage_publish, stage_submission_accepted, npm_cli_exit_zero, required_with_2fa, publicAvailability=not_claimed, and retry=forbidden. Receipt and attempt coordinates must match the workflow target. The absent authorization source means its issuance is not authenticated.

Report v1 binds evidence_bound, first_publication_npm_stage_result, target, upstream digests, artifact metadata/archive/recheck, non-identifying stage records, and seven ready checks. npm_cli_reported_stage_submission_accepted means only the preserved npm exit-zero result.

It does not authenticate upstream or authorization issuance, guarantee later artifact immutability, independently query registry staging, observe stage ID or tarball bytes, or prove approval/publication. Download is read-only; files/settings stay unchanged; dispatch/rerun/publication are not attempted; output is stdout only.

Failures distinguish arguments, online/input/source/binding, unavailable artifact, invalid observation/archive/digest/records/report, and source races. Adapter reasons are archive_size_invalid, response_invalid, artifact_mismatch, archive_invalid, artifact_changed, and authentication_or_artifact_unavailable. Output omits paths, digests, identities, stage IDs, credentials, redirects, and raw responses.

## Consequences

Download, race detection, bounded ZIP parsing, record validation, pure evidence, source reading, orchestration, and formatting remain separate. Fixtures cover descriptor variants, digest mismatch, traversal, duplicates, forged sizes, corruption, unknown terminals, target mismatch, races, forged authority, read-only behavior, and sensitive-data disposal.
