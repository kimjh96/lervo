# Deliberation results and evolution

## Results, search, and canonicalization

Application results distinguish `converged`, `no_consensus`, `failed`, `interrupted`, `unknown`, publication state, and origin-delivery state. `no_consensus` is a valid bounded outcome, not a transport or provider failure.

Unified search exposes authorized deliberation artifacts and outcomes as a distinct corpus class with stable artifact, claim, objection, verification, decision, and source coordinates. Search never changes outcome state or grants artifact access.

A converged decision may produce a reviewed work, documentation, or knowledge candidate. It becomes canonical only when the owning lifecycle accepts exact source-bound bytes. `no_consensus`, `failed`, and uncertain outcomes promote nothing.

## Compatibility and evolution

Version-1 deliberation artifacts, outcomes, events, and queue records remain readable without reinterpretation. New artifact events retain original summary fields and add the complete validated structured artifact as an optional, source-free projection source. They may include the policy-bound participant name used for presentation. Predecessors without that name remain readable and use honest role labeling, never an invented agent identity. Every duplicate coordinate must match.

Legacy events without the structured artifact remain valid but cannot independently reconstruct complete claim, objection, verification, and decision semantics. Product routes and `ProductDeliberationViewV1` are additive.

Future budget dimensions, principal kinds, artifact kinds, or terminal meanings require explicit new versions, current-and-predecessor fixtures, restart and rollback coverage, and historical replay.

## Host-neutral projection

Product-host protocol v11 exposes the host-neutral projector, reader-first sources, and installed read-only composition. The composition validates and joins:

- Queue origin.
- The exact embedded or hash-matching predecessor policy.
- Structured artifact events and verification evidence.
- Terminal outcome and participant bindings.
- Resource work coordinate and writing permit.
- Receipt-backed origin delivery.

Missing legacy evidence produces an explicit partial or unavailable result. It cannot be filled from notification configuration, topic text, native Discord identifiers, or empty default arrays. This query alone does not satisfy Discord-visible artifact updates or installed round-trip acceptance.
