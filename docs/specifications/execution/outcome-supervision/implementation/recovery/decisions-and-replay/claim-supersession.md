# Responsibility claim supersession

A `revise_responsibility` decision remains pending when its `work.responsibility_claim.v1` effect fails before any write. Exact acquisition is fenced and atomic, so failure before the transaction proves binding absence: no `work.responsibility.bound` event exists for the claim's deterministic binding identity, and the assignment record still matches the claim's expected hash.

The Node supersedes such a claim only when its source changed or its plan deadline passed. Supersession requires the current owner fence, installed authority, and an unchanged event head at the fenced transition.

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
- `invalidatedBy`: `source_changed` or `deadline_expired`

Supersession records the existing envelope-version-3 `work.supervision.decision.superseded` event; it introduces no new event type, prose, path, or credential. The decision journal validates the inspection using the same rules before treating the decision as superseded.

Without this path, an unbound claim kept every later cycle in `pending_decision_requires_reconciliation` although nothing had happened. Supersession proves only that the claim never bound. It does not release a lease, prove a worker did not start, or admit a later claim.

After supersession, the owner decides again over the current source. A successor responsibility whose completion window can no longer hold a bounded lease yields no automatic claim; the owner must propose a new responsibility or escalate.
