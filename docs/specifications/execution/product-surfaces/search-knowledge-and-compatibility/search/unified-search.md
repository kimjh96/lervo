# Unified search

Unified product search is a typed application query, not one universal index. It may compose bounded adapters for:

- Canonical repository Markdown and reviewed semantic sidecars.
- Current repository code and configuration.
- Integrity-checked conversation records.
- Artifacts and canvas revisions.
- Deliberation proposals, objections, revisions, verification artifacts, decisions, and terminal outcomes.
- Approvals, verification, work, and execution events.

Each adapter returns stable source coordinates, source revision or content hash, privacy class, result type, and bounded match evidence. Fusion receives coordinates and ordered ranks, not mutable vendor scores. Render a result only after current authorization and source validation. Search never grants access, creates work, approves an effect, or promotes content.

Lexical v2 may serve compatible textual corpora through separate prepared indexes, but repository knowledge, conversation, code, and artifact lifecycles remain distinct. A semantic or external stage requires its own exact plan, privacy and export policy, readiness receipt, failure meaning, cost observation, qualification, activation, and rollback.

The first installed product-host adapter serves only `repository_knowledge`. It reuses the existing qualified Lexical v2 repository-knowledge port, verifies a stable repository revision around the complete query, and projects privacy-bounded coordinates into `ProductUnifiedSearchResultV1`. This establishes the federation contract without claiming that the remaining corpora share its index, authorization, or lifecycle.
