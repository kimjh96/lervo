# ADR-0108: CLI first-publication package-metadata apply transaction

Status: `accepted`
Decision date: 2026-08-21

## Context

Applying package JSON alone immediately desynchronizes release manifest/SBOM. Filesystems offer no atomic three-path commit, so sequential rename must expose interruption and deterministic recovery rather than claim full atomicity.

## Decision

Add `metadata-apply --permit <absolute> --write --json` and separate `--recover`. Rebuild decision/preview/candidate/output and permit, snapshot permit/package/release manifest/SBOM/lockfile as bounded regular files, and confirm unchanged before first write.

Before writing, generate in memory: exact package candidate; production release manifest using package override; deterministic SBOM from new manifest and snapshotted lockfile. Validate current sources first. New manifest may differ only in approved metadata and derived artifact digest; reject unrelated build/dependency/archive drift.

Plan v1 binds permit/candidate and before/after count/hash for three writes plus read-only sources, requiring pre-write CAS, mode-preserving staged replacement, recovery journal, all-file rollback on synchronous failure, and explicit recovery after interruption.

Use exclusive owner-only `apps/cli/.lervo-metadata-apply-transaction`. Stage/journal every move/publication and preserve originals. Commit only after all after-digests and read-only sources match, then cleanup. Synchronous failure restores originals in reverse and verifies before hashes; failure leaves journal as rollback_failed.

Never infer rollback after process death. Block new apply before source reads. Recovery restores pre-commit, or preserves verified post-commit files and cleans only journal. Refuse live-owner recovery. This provides synchronous rollback/deterministic recovery, not instantaneous multi-file power-loss atomicity; a pending journal blocks all release/publication flows.

Success receipt binds plan/permit/candidate, all file bindings, cleanup, and regeneration effects. Output stdout only. Modify only package/release manifest/SBOM; not permit/lockfile/approval/external state. Temporary source never leaves local transaction.

Failures distinguish arguments/source/regeneration/plan/source-changed/apply/recovery-required/busy/not-found/journal/rollback, with no sensitive body/path/PID/digest echo.

## Consequences

Three derived files update consistently under synchronous failure and have explicit crash recovery without overstating filesystem atomicity.
