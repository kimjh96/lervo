# Unified search

Unified product search is a typed application query, not a universal index. It may compose bounded adapters for:

- Canonical repository Markdown and reviewed semantic sidecars.
- Current repository code and configuration.
- Integrity-checked conversation records.
- Artifacts and canvas revisions.
- Deliberation proposals, objections, revisions, verification artifacts, decisions, and terminal outcomes.
- Approvals, verification, work, and execution events.

Each adapter returns stable source coordinates, a source revision or content hash, privacy class, result type, and bounded match evidence. Fusion receives coordinates and ordered ranks, not mutable vendor scores. Results render only after current authorization and source validation. Search never grants access, creates work, approves an effect, or promotes content.

Lexical v2 may serve compatible textual corpora through separate prepared indexes. Repository knowledge, conversation, code, and artifact lifecycles remain distinct. A semantic or external stage requires its own exact plan, privacy and export policy, readiness receipt, failure meaning, cost observation, qualification, activation, and rollback.

[ADR-0560](../../../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the first installed product-host search adapter and `ProductUnifiedSearchResultV1`, which had no invoker. Repository knowledge search remains available through `lervo knowledge query`. No installed unified product search exists.
