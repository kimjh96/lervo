# ADR-0041: Signed, project-scoped, locally authorized remote commands

Status: `accepted`
Decision date: 2026-08-19

## Context

A Hub/channel request must not become `lervo run` directly. A valid signature may target another project or be stale, retries may repeat delivery, and Hub authorization cannot replace current repository policy. Raw requests must remain outside replay/signature metadata while idempotency, nonce, and content conflicts remain distinguishable.

## Decision

### Signed command contract

- `@lervo/remote-command-contract` owns the `managed_run` command, Ed25519 envelope, terminal receipt, schemas, IDs, and hashes.
- The target binds project ID and identity hash. The action binds role, provider, risk, required suites, and request-artifact coordinates—not the raw request.
- The request artifact is strict UTF-8 up to 64 KiB; its ID, digest, and count are signed.
- Derive `commandId` from the canonical command without its ID. Sign canonical `lervo.remote-command.v1`, algorithm, key ID, and complete command. Key ID is part of the trust slot.
- Ed25519 proves authenticity and integrity, not encryption or transport peer identity.

### Ordered receiver gate

Validate schema/ID → trust key → signature → signer project scope → receiver identity → replay → freshness → local policy. A completed replay may return its terminal receipt before freshness, recovering a lost response without rerunning. Otherwise require a default five-minute and maximum fifteen-minute lifetime, plus bounded skew.

Only after local approval, atomically reserve `(commandHash, idempotencyKey, nonce)`. Policy denial reserves nothing, allowing later human approval. Then load the artifact and verify size, digest, and UTF-8 before invoking a provider-neutral executor with the verified request and command.

The in-memory store uses a no-await critical section and indexes idempotency, nonce, and reservation coordinates. At capacity it fails closed rather than evicting replay protection.

### Terminal receipt

Unavailable or mismatched payloads and executor failures produce source-free terminal receipts. Redelivery returns the stored receipt with `deliveryStatus=duplicate` and never reruns. Success is `outcome=executed` plus run ID; failure is `outcome=failed` plus a fixed code.

`processed` means the terminal receipt was committed to the configured replay store—not event sync, Hub response delivery, verification, or user reading. Failure to complete replay state after execution is `replay_store_failed`; do not infer execution rollback. Add no event.

Envelope, trust, signature, scope, target, and freshness failures precede policy, payload, and executor work. Keep idempotency conflict, nonce replay, and in-progress distinct. Commands, receipts, and replay data exclude raw requests, keys, policy prose, and loader/executor exceptions; retain only artifact, key, and project coordinates.

Fixtures cover real Ed25519 signing, tampering, scope, identity, expiry, denial then approval, terminal duplicate behavior, payload/executor failure, idempotency/nonce conflicts, concurrent reservation, and source minimization.

## Consequences

Node applies signature verification, local authority, replay protection, and payload integrity independently of Hub, HTTP, channel, and provider. ADR-0042 adds durable delivery and replay.
