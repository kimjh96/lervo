# ADR-0425: Require supervision for deployed product owners

- Status: accepted
- Decision date: 2026-09-22

## Context

Outcome supervision was installed repository by repository during acceptance. Elio, Vero, and Sera
received reviewed authority while other deployed product owners remained ordinary conversation
participants. Owner-only configuration later advertised goal intake for some of those deployments
without an installed mandate. Exact-owner preflight removed that false claim, but setting the flag to
false still allowed a product-owner deployment to start without the capability its role promises.

There is no product policy that distinguishes product owners entitled to durable goal supervision
from product owners limited to one conversational turn. Optional supervision remains valid for a
Node with no deployed product owner, but it is not a valid steady state for a deployed repository
product owner.

## Decision

Resolve every configured Discord deployment against the repository's current durable workforce
before Node preflight and runtime composition. When one resolved deployment has role
`product-owner`, the Node requires:

- exactly one deployed product owner;
- a non-null durable agent identity;
- `acceptsSupervisionGoals: true` on that deployment; and
- one `outcomeSupervision` binding whose owner is that exact agent.

A mismatch is `invalid_config` and starts no conversation, supervision loop, or provider. Nodes
without a deployed product owner may continue without supervision. A repository needing multiple
independent owners requires separate Node authority or a future explicit multi-owner contract; one
binding is not silently shared.

Mandate installation remains a reviewed repository transition. Configuration validation cannot
create workstreams, approve mandates, copy authority between repositories, or replay historical
requests. Fleet rollout must install each repository's exact V3 standing mandate before enabling
the product-owner deployment.

Starting or upgrading that deployment is not itself an owner instruction. Without an exact bound
request the supervisor is dormant. If an older request is already bound at process start, the first
cycle establishes its source cursor without proposing or executing an effect; unresolved recorded
decisions still reconcile first. A new request bound after startup or a later canonical source
change is the required wakeup. This keeps authority installation, budget-policy revision, and
human intent as separate transitions. Request presence is checked before lease-side peer refresh,
pending result delivery, recovery, reasoning, or effect preparation.

## Consequences and verification

The role and deployment can no longer drift into a chat-only product owner. Credential preflight
and live composition apply the same pure invariant. Focused tests cover exact authority, missing
goal intake, wrong owners, non-owner deployments, and multiple owners. Installed acceptance must
show every product-owner Node passing preflight with its own reviewed mandate and must not infer
execution from process readiness.
