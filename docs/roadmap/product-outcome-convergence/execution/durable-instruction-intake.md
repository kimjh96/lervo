# Explicit durable-instruction intake

State: `wired`

Outcome: an explicit owner instruction becomes an applied durable repository instruction through an installed intake route, without owner review ([ADR-0561](../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).

Evidence:

- `knowledge instruction intake` invokes current-provider no-capability grounding only at the explicit command boundary, checks fidelity (owner wording, or an independent cross-check of a restatement), stores a bounded local candidate without raw request text, and applies it on a single host or the convergence owner.
- Broad, removal, policy, and authority-changing rules are stored with their classification. A conflicting older generated rule in the same scope is replaced. Grounding failure retains the request in the private capture queue for background retry.
- Apply rebuilds the deterministic plan against current bytes, writes the generated instruction, deletes replaced generated rules, emits the privacy-bounded materialization event, and removes the active candidate. The instruction becomes retrievable after the standard knowledge migration.
- `knowledge instruction retire` undoes an applied rule; the ADR-0549 notice reports each stored rule afterward.
- Tests cover the two owner rules the former gate dropped on 2026-11-02, every classification, the fidelity cross-check, replacement, retire, background retry, event evidence, and fresh query retrieval. Direct hooks retain zero automatic materialization.

Preserve bounded active-state retention, recoverable post-event cleanup, and the ADR-0327 retrieval-only direct hook.
