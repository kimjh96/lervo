# Installed bound-workstream canary

Part of [installed multi-party scope](installed-scope.md).

[ADR-0423](../../../../../decisions/execution/orchestration/governed-work/workstream-concurrency/0423-parallel-bound-workstreams.md) separates the selected review projection from the supervised bound workstream. [ADR-0424](../../../../../decisions/coordination/conversations/delivery/0424-bound-delivery-uncertainty-and-reconciliation.md) defines bounded delivery-uncertainty prevention and operator reconciliation.

Installed readiness, historical repairs, configuration checks, and source tests do not discharge the held multi-party approval. Acceptance still requires a fresh authorized Elio successor cycle with the selected review unchanged, a human-authored Shiflo PO-to-Nuri-to-Sora execution, and controlled redelivery, failure, retry, and restart evidence. Later Vero and Kael recoveries retain their own fresh-turn acceptance gaps.

- [Bound-workstream canary and publication diagnostics](installed-bound-canary/bound-workstream.md): r29–r31, identity, lineage, and evidence limits.
- [Human acceptance and routing corrections](installed-bound-canary/human-acceptance.md): Shiflo routes, failed human turns, and r35 correction.
- [Delivery recovery and peer observation](installed-bound-canary/delivery-recovery.md): historical Elio repair, r32, bound peer reads, and r33–r34 nonce-response protection.
- [Product-owner rollout](installed-bound-canary/product-owner-rollout.md): Shiflo acceptance target and other r32 deployments.
- [Vero silence and Python environments](installed-bound-canary/vero-environment.md): repository snapshots, dedicated-dialogue policy, and r36.
- [Repository-context recovery](installed-bound-canary/repository-context.md): generated caches, bounded event context, and r38.
- [Active Vero turn deadlines](installed-bound-canary/vero-deadlines.md): progress-aware provider limits and r39.
- [Kael sparse-workstream recovery](installed-bound-canary/kael-admission.md): verified sparse Hub checkpoints and r54.
