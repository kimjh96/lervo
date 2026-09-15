# ADR-0411: Governed agent memory and autonomous participation

- Status: accepted
- Decision date: 2026-09-16

## Context

Agent-ID-keyed context existed, but a promotion could pair summary bytes with a review that did not attest those bytes. Node then injected the newest active entries without task relevance, freshness, or sensitivity filtering. In conversation, deterministic ownership prevented response storms, but natural-language deployments forced their unaddressed human owner to answer and suppressed every unaddressed agent-authored contribution before relevance evaluation.

This was not a safe durable-memory or autonomous-participation contract. Broad automatic accumulation would have amplified stale, contradictory, private, or merely conversational claims.

## Decision

### Durable agent memory

`agent.context.promoted` version 2 metadata names the memory kind, stable subject key, agent-only audience, internal or restricted sensitivity, medium or high confidence, opaque retrieval digests, observation time, optional expiry, and review-binding version. Promotion still binds one exact source, CAS summary, review event, and optional superseded entry.

A qualifying review must attest the exact summary content hash. An approved knowledge candidate or reconciliation, verified knowledge item, passed verification result, or verified `conversation.repository_work.completed` event qualifies only when its own candidate or result hash equals the summary hash. A repository-work completion must additionally name the same worker agent. A generic passed review is insufficient.

Successful managed repository work automatically promotes its bounded published result as medium-confidence `work_outcome` memory for the exact worker. It expires after ninety days, uses the completion as both source and review, copies the exact bytes into repository CAS, and records only hashes of bounded retrieval terms. The event payload never exposes the result text or search terms. Retry uses deterministic event and entry identities.

One agent, layer, and subject may have only one active entry. Changed understanding must explicitly supersede it. Invalid time order, missing or mismatched evidence, or an unacknowledged contradiction fails closed. Shared repository facts continue through repository knowledge compilation; agent memory is for attributable work history, preferences, relationships, decisions, and expertise.

Node materializes at most eight active, unexpired, internal entries whose retrieval digests match the current request. Restricted, expired, superseded, and unrelated entries remain inspectable but are not sent to a provider. Selection, document loading, injection, and provider use remain distinct evidence claims; rendering an entry does not prove provider use.

### Autonomous participation

Natural-language deployments default unaddressed human messages to semantic evaluation. Deterministic ownership still selects at most one eligible responder, but ownership no longer forces a reply. The owner may answer, observe, or delegate a bounded task to an already hired specialist without requiring the person to name that specialist.

An unaddressed agent-authored contribution now selects one non-source deterministic owner and then runs the same semantic relevance gate. Explicit mentions remain available but are not required. Automation depth, source suppression, cooldown, hourly limits, effect authorization, and provider budgets remain independent bounds, so this enables useful initiative without enabling broadcast response storms.

These decisions live in conversation, organization, context, and execution contracts. Discord supplies normalized events and delivery only; another product surface can reuse the same behavior.

## Failure and privacy meaning

- Review/hash, agent, time, subject, or CAS disagreement rejects promotion or materialization.
- Restricted memory is retained locally but is not provider-injected.
- Expiry and relevance filtering produce omission, not deletion or a claim that the memory is false.
- A non-owner records `turn_not_owned`; an owner that judges no useful contribution records `not_relevant`.
- No raw message, result, retrieval term, credential, provider state, or hidden reasoning enters an agent-context event payload.

## Consequences

CEO, product-owner, and hired-agent identities can accumulate provider-neutral work continuity from verified managed work immediately, while higher-confidence preferences, relationships, decisions, and expertise still require exact reviewed promotion. Participants can join relevant human or agent discussion without mention syntax, but only through a single bounded responder path.

The design intentionally does not treat every conversation as knowledge, automatically promote high-confidence organizational facts, or share personal memory across repositories. Those claims require repository knowledge or explicit handoff.

## References

- [ADR-0390](../0390-project-reviewed-agent-context-and-headless-organization-control.md)
- [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0408](../0408-conversation-task-delegation-to-hired-agents.md)
- [Reviewed agent context](../../../../architecture/system/agent-organization/reviewed-agent-context.md)
