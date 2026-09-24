# Responsibility claim supersession

A `revise_responsibility` decision remains pending when its `work.responsibility_claim.v1` effect fails before any write. Exact acquisition is fenced and atomic, so failure before the transaction proves binding absence: no `work.responsibility.bound` event exists for the claim's deterministic binding identity, and the assignment record still matches the claim's expected hash.

The Node supersedes such a claim only when its source changed or it expired. A claim expires at the earlier of its plan deadline and its responsibility `startDeadline`, because it can never bind at or after the start deadline. The plan deadline is the later completion deadline. The runtime reads the start deadline through the optional `readEffectStartDeadline` port and treats the pending decision as expired from that instant. Supersession requires the current owner fence, installed authority, and an unchanged event head at the fenced transition.

Waiting for the plan deadline alone left a gap. After the start deadline, admission rejected the claim as stale on every cycle, while supersession still refused it for up to the whole completion window. Kael hit this on 2026-09-24 and failed a cycle every ten seconds for almost an hour.

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
- `invalidatedBy`: `source_changed` or `deadline_expired`. `deadline_expired` is valid once `observedAt` reaches the earlier of the plan deadline and the start deadline of the exact claim effect.

Supersession records the existing envelope-version-3 `work.supervision.decision.superseded` event; it introduces no new event type, prose, path, or credential. The decision journal validates the inspection using the same rules before treating the decision as superseded.

Without this path, an unbound claim kept every later cycle in `pending_decision_requires_reconciliation` although nothing had happened. Supersession proves only that the claim never bound. It does not release a lease, prove a worker did not start, or admit a later claim.

After supersession, the owner decides again over the current source. A successor responsibility whose completion window can no longer hold a bounded lease yields no automatic claim; the owner must propose a new responsibility or escalate.

When an effect ends `uncertain`, the Node journal also receives the line `Lervo supervision effect uncertain (<actionKind> <effectContract>): <error name>: <first 200 characters of the message>`. Canonical attention keeps only bounded reason codes. The line is host diagnostics, not evidence: it proves neither non-start nor the cause of a later supersession.
