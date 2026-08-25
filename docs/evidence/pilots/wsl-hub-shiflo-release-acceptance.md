# WSL Hub and Shiflo release acceptance

Status: `passed`  
Date: 2026-08-24

## Scope and topology

The existing Shiflo repository on macOS was the project authority, with a user-level Lervo Node on the same device. The optional shared Hub ran continuously as a systemd user service in Ubuntu WSL2 on Windows. Authenticated HTTPS crossed the existing private overlay, but the protocol and implementation do not depend on that network product.

No npm publication, remote Git push, or Shiflo commit occurred. Existing changes were preserved. Temporary provider pilot output was removed; tracked verification-suite definitions remain as historical event dependencies.

## Installed candidates

| Component | Candidate and integrity |
| --- | --- |
| CLI on macOS | locally packed `0.1.0`, SHA-256 `817d2822f58f8754326ef7e2542d560e04f577bc4c88ba17383b99e8171e0bad` |
| Hub in WSL2 | standalone Linux x64 glibc `0.1.0`, SHA-256 `03800f88728ffbc7b7b3adc5d5abd9866e38982b574ab88f527100d30afc3123` |
| Node on macOS | standalone Darwin arm64 `0.1.0`, SHA-256 `a726e09615e91da07287ee220ddba47ffed0c31ed20819db12fb0baea29edc29` |

The Hub came from clean baseline `55bc6ef7895718367d77cba8ae597d2c98097f2b`. The CLI and Node include this revision's acceptance fixes. Previous runtime directories remain as local rollback material; active service definitions target these candidates.

## Local repository and managed providers

- Knowledge lint validated 43 concepts with no issues.
- Query `documentation governance canonical update rules` ranked `docs/repository/documentation-governance.md` first, scoring 26.
- Codex run `run_e06b52de950e40cb83c2f53db1d7bde6` changed only its declared pilot path; project verification and isolated writing evaluation passed.
- Claude run `run_1aa6ac0a6abf4d95ac7ae906add6b2dc` omitted a required period. Exact project verification rejected it, showing that provider completion alone cannot produce Lervo success.
- Claude retry `run_e9eb4c11aa054f56b92c82428a471641` changed only its declared pilot path; project verification and isolated writing evaluation passed.

The repository exposed a managed-context collision: `AGENTS.md` entered through instruction discovery and repository knowledge under different identities and metadata. The final CLI canonicalizes an identical path to one deterministic document identity while retaining knowledge context and required-instruction evidence. Targeted full-context preparation and both real providers then passed.

## Hub and Node acceptance

The WSL Hub was enabled and active under systemd user management and passed identity-bound readiness. The macOS Node was enabled and active under launchd and passed its live-process readiness snapshot. Node configuration selects one project, destination, Hub identity, and provider-host allowlist. Device-local coordinates and credentials were not copied into repository documents or command output.

Before reconciliation:

| Source | Events | Cursor or outbox |
| --- | ---: | ---: |
| Shiflo local event chain | 245 | outbox 0 |
| WSL Hub Shiflo project | 0 | cursor 0 |

Registration and readiness therefore did not imply delivery: production event producers had not populated the outbox; only test fixtures had. ADR-0194 assigned that responsibility to the explicitly configured Node without coupling the local CLI or providers to Hub configuration.

After installing the corrected Node:

| Source | Observed result |
| --- | ---: |
| Shiflo local event chain | 245 events |
| Shiflo destination outbox | 245 acknowledged, 0 pending |
| WSL Hub Shiflo project | cursor 245, 245 stored events |
| WSL Hub Shiflo trace index | 23 runs |

Unit integration also backfilled 205 events in bounded 100/100/5 cycles, repaired existing destination gaps, and failed closed when the authenticated Hub cursor differed from the local event hash.

## Restart and service lifecycle

After systemd and launchd restarts, the Hub returned to identity-bound ready, the Node returned to live-process ready, and all counts remained unchanged.

Two upgrades hardened service management:

- A WSL systemd service briefly reported active before a broken launcher exited. Installation now requires three operational observations separated by 500 milliseconds and compensates a transient activation.
- launchd briefly retained old process state after `bootout`. Removal now permits six observations and requires three consecutive stopped observations before deleting the exact service definition.

OS service status, runtime readiness, and event delivery remain distinct. Database counts are the delivery evidence.

## Claims and limits

For the observed environment, this pilot demonstrates local knowledge workflows, real managed Codex and Claude execution, exact-verification rejection, installation from local archives, service restart, destination-bound reconciliation, authenticated delivery, and durable Hub persistence.

It does not establish provider understanding beyond telemetry, artifact-body synchronization, repository-file replication, npm publication, automatic runtime upgrades, organization deployment policy, or future availability.

## References

- [Shiflo local v0 pilot](shiflo-v0.md)
- [ADR-0194](../../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [ADR-0164](../../decisions/operations/services/0164-user-runtime-service-management-boundary.md)
