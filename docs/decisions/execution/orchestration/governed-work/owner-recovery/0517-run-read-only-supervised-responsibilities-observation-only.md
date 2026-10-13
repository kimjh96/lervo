# ADR-0517: Run read-only supervised responsibilities observation-only

Status: `accepted`
Decision date: 2026-10-14

## Context

axli's product-owner responsibility asked for a read-only decision:

- its purpose says "Do not change repository files";
- its only required capability is `filesystem.read`;
- its expected path `docs/product/vision.md` scopes what the decision covers.

The supervised managed run still started in write mode with that path as its write target. The product-owner role writes under `require_approval`, and supervised runs carry no signed write approval. The run therefore failed its approval preflight with `approval_required`, and the owner escalated (`approval_required_preflight`) for an approval the task never needed.

## Decision

A supervised managed run whose responsibility does not require `filesystem.write` runs with `executionMode: "read_only"` and no write targets. Its expected paths still steer context selection and knowledge readiness. A responsibility that requires `filesystem.write` keeps its write targets and the role's approval rules.

## Consequences

A read-only owner decision runs without a write approval it does not need and produces its result artifact. A write-capable responsibility still needs approval under `require_approval`.

## Verification

- Unit tests cover the read-only classification.
- The orchestrator's existing approval test covers a `require_approval` role narrowed to an observation-only run with no write targets.
