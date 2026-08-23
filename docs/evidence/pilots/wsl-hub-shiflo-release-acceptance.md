# WSL Hub and Shiflo release acceptance

Status: `passed`
Date: 2026-08-24

## Scope and topology

This acceptance used the existing Shiflo repository on macOS as the project authority and a user-level Lervo Node on the same device. The optional shared Hub ran continuously as a systemd user service in Ubuntu WSL2 on a Windows host. Authenticated HTTPS crossed the existing private overlay, but neither the protocol nor implementation depends on that network product.

No npm registry publication, remote Git push, or Shiflo commit occurred. Existing Shiflo changes were preserved. Temporary provider pilot output was removed after verification; its tracked verification-suite definitions remain as historical event dependencies.

## Installed candidates

| Component | Candidate and integrity |
|---|---|
| CLI on macOS | locally packed `0.1.0`, SHA-256 `817d2822f58f8754326ef7e2542d560e04f577bc4c88ba17383b99e8171e0bad` |
| Hub in WSL2 | standalone Linux x64 glibc `0.1.0`, SHA-256 `03800f88728ffbc7b7b3adc5d5abd9866e38982b574ab88f527100d30afc3123` |
| Node on macOS | standalone Darwin arm64 `0.1.0`, SHA-256 `a726e09615e91da07287ee220ddba47ffed0c31ed20819db12fb0baea29edc29` |

The Hub candidate came from clean baseline `55bc6ef7895718367d77cba8ae597d2c98097f2b`. The CLI and Node candidates include the acceptance fixes recorded by this revision. Previous runtime directories remain local rollback material; active service definitions point to the candidates above.

## Local repository and managed providers

- Shiflo knowledge lint reported a valid registry with 43 concepts and zero issues.
- Query `documentation governance canonical update rules` ranked `docs/repository/documentation-governance.md` first with score 26.
- Codex managed run `run_e06b52de950e40cb83c2f53db1d7bde6` changed only its declared pilot path; project verification and isolated writing evaluation passed.
- Claude run `run_1aa6ac0a6abf4d95ac7ae906add6b2dc` omitted the required period. Exact project verification rejected it, demonstrating that provider completion alone cannot produce Lervo success.
- Claude retry `run_e9eb4c11aa054f56b92c82428a471641` changed only its declared pilot path; project verification and isolated writing evaluation passed.

The external repository also exposed a managed-context collision: `AGENTS.md` could enter through both instruction discovery and repository knowledge under different IDs and metadata. The final CLI canonicalizes an identical path to one deterministic document identity while retaining both knowledge context and required-instruction evidence. Targeted full-context preparation and both real providers passed afterward.

## Hub and Node acceptance

The WSL Hub was enabled and active through systemd user service management and passed identity-bound readiness. The macOS Node was enabled and active through launchd and passed its live-process readiness snapshot. The Node configuration selects one project, destination, Hub identity, and provider-host allowlist; those device-local coordinates and credentials were not copied into repository documents or command output.

Before destination reconciliation, the state was:

| Source | Events | Cursor or outbox |
|---|---:|---:|
| Shiflo local event chain | 245 | outbox 0 |
| WSL Hub Shiflo project | 0 | cursor 0 |

This proved that registration and readiness did not imply delivery. Production event producers never populated the outbox; only test fixtures did. ADR-0194 moved that responsibility to the explicitly configured Node without coupling local CLI or providers to Hub configuration.

After installing the corrected Node:

| Source | Observed result |
|---|---:|
| Shiflo local event chain | 245 events |
| Shiflo destination outbox | 245 acknowledged, 0 pending |
| WSL Hub Shiflo project | cursor 245, 245 stored events |
| WSL Hub Shiflo trace index | 23 runs |

Unit integration also backfilled 205 events as bounded 100/100/5 cycles, repaired existing destination gaps, and failed closed when the authenticated Hub cursor differed from the local event hash.

## Restart and service lifecycle

The Hub was restarted through systemd and returned to identity-bound ready. The Node was restarted through launchd and returned to live-process ready. The counts above remained identical after both restarts.

Two real upgrades hardened service management:

- A WSL systemd service briefly reported active before a broken launcher exited. Installation now requires three operational observations separated by 500 milliseconds and compensates a transient activation.
- launchd briefly retained the old process state immediately after `bootout`. Removal now allows six observations and requires three consecutive stopped observations before deleting the exact service definition.

OS service status remains distinct from runtime readiness, and both remain distinct from event delivery. The database counts above are the delivery evidence.

## Claims and limits

This pilot demonstrates local knowledge workflows, real managed Codex and Claude execution, exact verification rejection, installation from local archives, service restart, destination-bound event reconciliation, authenticated delivery, and durable Hub persistence for the observed environment.

It does not claim provider understanding beyond telemetry, artifact-body synchronization, repository-file replication, npm publication, automatic runtime upgrade, organization deployment policy, or future availability.

## References

- [Shiflo local v0 pilot](shiflo-v0.md)
- [ADR-0194](../../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [ADR-0164](../../decisions/operations/services/0164-user-runtime-service-management-boundary.md)
