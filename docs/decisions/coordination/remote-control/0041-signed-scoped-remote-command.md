# ADR-0041: Signed, project-scoped, locally authorized remote commands

Status: `accepted`
Decision date: 2026-08-19

## Context

A Hub/channel request must not become `lervo run` directly. A valid signature may target another project or be stale, retries may repeat delivery, and Hub authorization cannot replace current repository policy. Raw requests must also stay out of replay/signature metadata while idempotency/nonce/content conflicts remain distinguishable.

## Decision

### Signed command contract

- `@lervo/remote-command-contract` owns `managed_run` command, Ed25519 envelope, terminal receipt, schemas, IDs, and hashes.
- Target binds project ID and identity hash. Action binds role, provider, risk, required suites, and request-artifact coordinates—not raw request.
- Request artifact is strict UTF-8 up to 64 KiB; ID, digest, and count are signed.
- Derive `commandId` from canonical command excluding ID. Sign canonical `lervo.remote-command.v1`, algorithm, key ID, and complete command. Key ID is part of the trust slot.
- Ed25519 proves authenticity/integrity, not encryption or transport peer identity.

### Ordered receiver gate

Validate schema/ID → trust key → signature → signer project scope → receiver identity → replay → freshness → local policy. A completed replay may return its terminal receipt before freshness, enabling lost-response recovery without rerun. Otherwise require default five-minute, maximum fifteen-minute lifetime plus bounded skew.

Only after local approval atomically reserve `(commandHash, idempotencyKey, nonce)`. Policy denial reserves nothing, allowing later human approval. Then load artifact and verify size/digest/UTF-8 before invoking a provider-neutral executor with verified request and command.

The in-memory store uses a no-await critical section and indexed idempotency, nonce, and reservation coordinates. At capacity it fails closed instead of evicting replay protection.

### Terminal receipt

Payload unavailable/mismatch and executor failure yield source-free terminal receipts. Redelivery returns stored receipt with `deliveryStatus=duplicate` and never reruns. Success is `outcome=executed` plus run ID; failure is `outcome=failed` plus fixed code.

`processed` means terminal receipt was committed to configured replay store—not event sync, Hub response delivery, verification, or user reading. Failure to complete replay state after execution is `replay_store_failed`; do not infer execution rollback. Add no event.

Envelope/trust/signature/scope/target/freshness failures occur before policy/payload/executor. Keep idempotency conflict, nonce replay, and in-progress distinct. Commands/receipts/replay exclude raw request, keys, policy prose, and loader/executor exceptions; keep only artifact/key/project coordinates.

Fixtures cover real Ed25519 signing, tampering/scope/identity/expiry, denial then approval, terminal duplicate behavior, payload/executor failure, idempotency/nonce conflicts, concurrent reservation, and source minimization.

## Consequences

Node applies signature, local authority, replay, and payload integrity independently of Hub/HTTP/channel/provider. ADR-0042 adds durable delivery and replay.
