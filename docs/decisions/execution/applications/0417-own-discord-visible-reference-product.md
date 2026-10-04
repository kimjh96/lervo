# ADR-0417: Own a Discord-visible reference product

- Status: accepted
- Decision date: 2026-09-16

## Context

Lervo has provider-neutral contracts for work, authority, knowledge, evidence, verification, organization, conversation, search, and recovery. Discord is the first installed collaboration surface; the packed product-host protocol lets separate applications compose these contracts. Yet the product-outcome roadmap classified the unified operating view and complete product interfaces as external products.

That classification conflicts with the direction derived from Paperclip, Buzz, Prime Agent, and Hermes. A core primitive, fixture, CLI route, or static projection is not a completed product outcome if the current user-facing surface cannot expose it. Lervo also plans a first-party surface that must not create a second task, conversation, memory, knowledge, or authority system.

## Decision

Lervo owns two outcomes:

1. Discord is the current installed reference product surface.
2. A future first-party Lervo surface will replace or coexist with Discord through the same versioned application contracts.

A Lervo-owned capability is complete only when its core contract and a real installed Discord journey pass. Platform-independent contract tests must prove that a non-Discord host adapter can drive the same journey. The first-party surface must pass that shared suite when it ships, without importing Discord configuration or behavior.

Discord remains a transport and presentation adapter. Neither it nor the future first-party surface owns repository state, workstreams, assignments, leases, approvals, completion, verification, agent context, canonical knowledge, or source handoff. Surface actions enter typed application commands; reads use bounded queries and event-derived projections.

The reference product includes these bounded delivery slices:

- Natural multi-agent participation with durable hired-agent identities.
- Optional evidence-bound deliberation for explicit high-assurance decisions, separate from ordinary conversation.
- Goal-to-verified-result supervision and return to the originating conversation.
- Mac-offline source handoff and verified hand-back.
- An event-derived activity feed and typed live-steering commands.
- Source-linked search across messages, repository knowledge, code, approvals, verification, and artifacts.
- Channels, threads, canvases, workflows, files, and media needed for repository work.
- A unified operating view of objectives, staff, assignments, dependencies, blockers, approvals, verification, usage, and observed cost.

Every surface reuses Lervo's causal observability. Document recommendation, selection, loading, injection, and reference remain separate. Render provider token groups, cached-input tokens, projection and normalization cache observations, stage timing, evidence completeness, verification, and delivery without merging meanings or converting unavailable values to zero.

The [product-surface specification](../../../specifications/execution/product-surfaces.md) defines responsibility, Discord acceptance, search and canonicalization boundaries, and compatibility. The [Discord-first reference-product roadmap](../../../roadmap/product-outcome-convergence/host-products/discord-first-reference-product.md) defines delivery order and installed gates.

## Search and knowledge

Product surfaces use the resolved Lervo repository-context composition. Qualified Lexical v2 remains the product-default repository-knowledge ranker unless an exact reviewed repository selection specifies otherwise. Unified search composes typed corpus adapters above source coordinates; it does not put messages, code, artifacts, or approval records in a new canonical database.

Search recommendation, selection, loading, injection, reference, and semantic use remain distinct. Conversation or canvas material becomes canonical repository knowledge only through the existing source-bound review and materialization lifecycle.

## Compatibility

Product-host protocol versions are immutable capability contracts. New product routes are additive in a new explicit version; older versions retain their meaning until separately reviewed retirement. Do not rewrite canonical events or content for a presentation version. Readers advertise supported schemas before a writer activates a newer schema. Migrations are plan/apply and content-bound; rollback restores a compatible application or projection without fabricating historical evidence.

Host capability negotiation, typed unknown-field handling, stable source coordinates, and common contract suites must let later Lervo product versions change UI, search adapters, providers, or execution harnesses without changing existing work or evidence meanings.

## Consequences

The unified operating view and first-party reference interface become Lervo-owned `delivery required` outcomes rather than external-product exclusions. Separately installed products remain supported through the same headless boundary.

Discord-native limitations may change presentation, but not acceptance meaning. A canvas may appear as a versioned artifact and pinned thread; an activity feed may appear as coalesced thread updates. Coordinates, authority, evidence, and replay remain surface-neutral.

This decision authorizes no implementation, credentials, new external effects, or Discord slash-command goal path. Natural goal intake continues through the managed intent boundary.

## References

- [Product vision](../../../product/vision.md)
- [System architecture](../../../architecture/system.md)
- [Product-host protocol](../../../specifications/execution/product-host-protocol.md)
- [Product outcome convergence](../../../roadmap/product-outcome-convergence.md)
- [Natural-language Discord conversation routing](../../coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [Product-default Lexical v2 surface convergence](../../search/engines/0413-close-product-default-lexical-v2-surface-gaps.md)
- [Bounded deliberation decision workflow](0418-retain-deliberation-as-bounded-decision-workflow.md)
