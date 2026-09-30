# Claim contract and absence evidence

A `revise_responsibility` decision remains pending if its `work.responsibility_claim.v1` effect fails before any write. Exact acquisition is fenced and atomic, so failure before the transaction proves binding absence: no `work.responsibility.bound` event exists for the claim's deterministic binding identity, and the assignment record still matches the claim's expected hash.

The Node supersedes such a claim only when its source changes or it expires. Expiry is the earlier of the plan deadline and the responsibility `startDeadline`: the claim cannot bind at or after the start deadline. The plan deadline is the later completion deadline. The runtime reads the start deadline through the optional `readEffectStartDeadline` port and treats the pending decision as expired from that instant.

Supersession requires the current owner fence, installed authority, and an unchanged event head at the fenced transition.

The version-7 `work.effect_absence` inspection contains exactly:

- `schemaVersion`
- `kind`
- `effectContract`
- `decisionId`
- `planHash`
- `effectHash`
- `sourceRevisionDigest`
- `assignmentId`
- `assignmentSourceHash`
- `bindingEventAbsent`
- `eventHeadHash`
- `observedAt`
- `invalidatedBy`

`invalidatedBy` is `source_changed` or `deadline_expired`. `deadline_expired` is valid once `observedAt` reaches the earlier of the plan deadline and the start deadline of the exact claim effect.

Supersession records the existing envelope-version-3 `work.supervision.decision.superseded` event. It introduces no new event type, prose, path, or credential. The decision journal validates the inspection by the same rules before treating the decision as superseded.

Supersession proves only that the claim never bound. It does not release a lease, prove a worker did not start, or admit a later claim. Without this path, an unbound claim kept later cycles in `pending_decision_requires_reconciliation` although nothing had happened.

After supersession, the owner decides again over the current source. A successor responsibility whose completion window cannot hold a bounded lease yields no automatic claim; the owner must propose a new responsibility or escalate.

## Recorded failure

Waiting for the plan deadline alone left a gap: after the start deadline, admission rejected the claim as stale on every cycle, but supersession refused it for up to the entire completion window. Kael encountered this on 2026-09-24, failing a cycle every ten seconds for almost an hour.
