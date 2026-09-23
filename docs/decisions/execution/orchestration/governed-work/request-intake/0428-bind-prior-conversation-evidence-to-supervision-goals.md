# ADR-0428: Bind prior conversation evidence to supervised Discord goals

- Status: accepted
- Decision date: 2026-09-24

## Context

The installed owner bound only the latest Discord message text. A deictic request such as “those four tasks” could be admitted, yet owner reasoning did not receive the preceding delivered answer that enumerated the tasks. The owner correctly refused to invent a missing fourth scope, but a separately malformed local-attention proposal then failed materialization on every supervision cycle. The proposal-routing defect is fixed independently; preserving the original conversation context is an intake responsibility.

## Decision

For new Discord goal bindings, the intake captures a bounded snapshot of earlier turns from the same project, conversation and thread. It includes inbound turns completed by intake whose platform event time preceded the source event, and outbound replies actually delivered before that event. The ordinary eight-turn window also retains up to four earlier human anchors. A delayed inbound processing timestamp does not erase an earlier human message; a reply delivered after the request was sent cannot be treated as prior context. Later retries cannot import turns whose platform event time follows the bound ingress.

The version-two private request artifact retains each selected excerpt, speaker, source row identity, source record hash, CAS content hash and observation time. The canonical binding event still carries only the request-artifact hash and no raw conversation text or participant IDs. Owner reasoning rechecks every selected row and the exact CAS bytes before using the snapshot. A missing, conflicting or undelivered source fails closed; an unverified snapshot is not promoted into owner facts. Earlier assistant prose supplies interpretation evidence, not new human authorization or proof that its proposed work occurred.

Version-one request artifacts remain readable without manufactured context. Replaying an exact already-bound source compares the authenticated request and origin; it returns the original immutable binding even if a later retry sees a different history window. It never rewrites the bound snapshot or starts a second goal. Local stdin requests retain their version-one artifact and need no conversation store.

## Consequences

The installed owner can interpret context-dependent Discord requests from durable source evidence instead of guessing from the current sentence. Context capture adds bounded local reads at admission and verification; it does not add Hub dependence, authorize new assignments, prove provider execution, or publish results. Source loss or corruption remains visible as unavailable supervision rather than silently dropping or inventing context.

## References

- [ADR-0401](../0401-bind-installed-supervision-requests-across-surfaces.md)
- [Request binding contract](../../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake/binding.md)
