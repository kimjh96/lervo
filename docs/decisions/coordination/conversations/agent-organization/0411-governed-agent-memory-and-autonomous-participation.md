# ADR-0411: Governed agent memory and autonomous participation

- Status: accepted
- Decision date: 2026-09-16

## Context

Agent-ID-keyed context allowed promotions to pair summary bytes with reviews that did not attest those bytes. Node injected the newest active entries without task relevance, freshness, or sensitivity filtering. Deterministic conversation ownership prevented response storms, but natural-language deployments forced the owner of an unaddressed human message to answer and suppressed all unaddressed agent-authored contributions before relevance evaluation.

These behaviors did not provide safe durable memory or autonomous participation. Broad automatic accumulation would amplify stale, contradictory, private, or merely conversational claims.

## Decision

### Durable agent memory

`agent.context.promoted` version 2 metadata specifies memory kind, stable subject key, agent-only audience, internal or restricted sensitivity, medium or high confidence, opaque retrieval digests, observation time, optional expiry, and review-binding version. Promotion binds one exact source, CAS summary, review event, and optional superseded entry.

A qualifying review must attest the exact summary content hash. An approved knowledge candidate or reconciliation, verified knowledge item, passed verification result, or verified `conversation.repository_work.completed` event qualifies only if its own candidate or result hash equals the summary hash. Repository-work completion must also name the same worker agent. A generic passed review is insufficient.

Successful managed repository work automatically promotes its bounded published result as medium-confidence `work_outcome` memory for the exact worker. The memory expires after ninety days, uses the completion as both source and review, copies exact result bytes into repository CAS, and records only hashes of bounded retrieval terms. Event payloads expose neither result text nor search terms. Retries use deterministic event and entry identities.

Each agent, layer, and subject combination may have only one active entry. Changed understanding must explicitly supersede that entry. Invalid time order, missing or mismatched evidence, and unacknowledged contradictions fail closed. Shared repository facts continue through repository knowledge compilation; agent memory holds attributable work history, preferences, relationships, decisions, and expertise.

Node materializes at most eight active, unexpired, internal entries whose retrieval digests match the current request. Restricted, expired, superseded, and unrelated entries remain inspectable but are not sent to a provider. Selection, document loading, injection, and provider use are distinct evidence claims; rendering does not prove provider use.

### Autonomous participation

Natural-language deployments default unaddressed human messages to semantic evaluation. Deterministic ownership selects at most one eligible responder without forcing a reply. The owner may answer, observe, or delegate a bounded task to an already hired specialist without requiring the person to name that specialist.

An unaddressed agent-authored contribution selects one non-source deterministic owner, then passes through the same semantic relevance gate. Explicit mentions remain available but are optional. Automation depth, source suppression, cooldown, hourly limits, effect authorization, and provider budgets remain independent bounds against broadcast response storms.

These decisions belong to conversation, organization, context, and execution contracts. Discord supplies only normalized events and delivery; other product surfaces can reuse the behavior.

## Failure and privacy meaning

- Review/hash, agent, time, subject, or CAS disagreement rejects promotion or materialization.
- Restricted memory remains local and is not provider-injected.
- Expiry and relevance filtering omit memory; they neither delete it nor claim it is false.
- A non-owner records `turn_not_owned`; an owner finding no useful contribution records `not_relevant`.
- Agent-context event payloads exclude raw messages, results, retrieval terms, credentials, provider state, and hidden reasoning.

## Consequences

CEO, product-owner, and hired-agent identities can immediately accumulate provider-neutral work continuity from verified managed work. Higher-confidence preferences, relationships, decisions, and expertise still require exact reviewed promotion. Participants can join relevant human or agent discussions without mention syntax through a single bounded responder path.

The design does not treat every conversation as knowledge, automatically promote high-confidence organizational facts, or share personal memory across repositories. Those claims require repository knowledge or explicit handoff.

## References

- [ADR-0390](../0390-project-reviewed-agent-context-and-headless-organization-control.md)
- [ADR-0391](../0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0408](../0408-conversation-task-delegation-to-hired-agents.md)
- [Reviewed agent context](../../../../architecture/system/agent-organization/reviewed-agent-context.md)
