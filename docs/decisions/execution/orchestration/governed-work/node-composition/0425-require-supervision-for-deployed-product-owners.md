# ADR-0425: Require supervision for deployed product owners

- Status: accepted
- Decision date: 2026-09-22

## Context

Outcome supervision was installed repository by repository during acceptance. Elio, Vero, and Sera received reviewed authority; other deployed product owners remained ordinary conversation participants. Owner-only configuration later advertised goal intake for some deployments without an installed mandate. Exact-owner preflight removed that false claim, but setting the flag to false still allowed a product-owner deployment to start without its promised capability.

No product policy distinguishes product owners entitled to durable goal supervision from those limited to one conversational turn. Optional supervision is valid for a Node without a deployed product owner, but not as a steady state for a deployed repository product owner.

## Decision

Resolve every configured Discord deployment against the repository's current durable workforce before Node preflight and runtime composition. If any resolved deployment has role `product-owner`, require:

- Exactly one deployed product owner.
- A non-null durable agent identity.
- `acceptsSupervisionGoals: true` on that deployment.
- One `outcomeSupervision` binding owned by that exact agent.

A mismatch is `invalid_config` and starts no conversation, supervision loop, or provider. Nodes without a deployed product owner may continue without supervision. Multiple independent owners require separate Node authority or a future explicit multi-owner contract; one binding is not silently shared.

Mandate installation remains a reviewed repository transition. Configuration validation cannot create workstreams, approve mandates, copy authority between repositories, or replay historical requests. Fleet rollout must install each repository's exact V3 standing mandate before enabling its product-owner deployment.

Starting or upgrading a deployment is not an owner instruction. Without an exact bound request, the supervisor is dormant. If an older request is already bound at process start, the first cycle establishes its source cursor without proposing or executing an effect; unresolved recorded decisions still reconcile first. Wakeup requires a new request bound after startup or a later canonical source change. Authority installation, budget-policy revision, and human intent remain separate transitions. Check request presence before lease-side peer refresh, pending result delivery, recovery, reasoning, or effect preparation.

## Consequences and verification

The role and deployment can no longer drift into a chat-only product owner. Credential preflight and live composition apply the same pure invariant. Focused tests cover exact authority, missing goal intake, wrong owners, non-owner deployments, and multiple owners. Installed acceptance must show every product-owner Node passing preflight with its own reviewed mandate and must not infer execution from process readiness.
