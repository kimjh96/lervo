# ADR-0390: Project reviewed agent context and headless organization control

- Status: accepted
- Decision date: 2026-09-09

## Context

Durable hired-agent identity did not preserve reviewed expertise across turns or provider replacement. Discord conversations already used Lervo's product-default repository search, knowledge recommendations, relation projection, context coordinator, managed provider execution, evidence, and budgets, but lacked a separately governed agent-context source. A future Lervo product also needed an installed application boundary for organization views and CEO decisions without copying repository truth into a Discord-specific or product-owned database.

## Decision

Lervo adds an agent-ID-keyed, provider-neutral context projection beside repository search for every managed conversation turn. It shares the context selection, loading, injection, and evidence path. Discord neither owns nor bypasses it; other conversation surfaces can reuse the managed responder.

Only reviewed material enters durable context. `agent.context.promoted` requires:

- An active hired-agent identity.
- One `work`, `relationship`, or `expertise` layer.
- An exact event or CAS artifact source and hash.
- A CAS summary of at most 32 KiB.
- An exact qualifying review event and hash; a `verification.completed` review qualifies only if it passed.
- Promotion time.

[ADR-0411](agent-organization/0411-governed-agent-memory-and-autonomous-participation.md) further requires review attestation of the exact summary hash and promotion coordinates for subject, kind, audience, sensitivity, confidence, opaque retrieval, observation, and expiry. Node injects only bounded relevant internal entries. Verified managed repository-work results may enter automatically as expiring medium-confidence work history; shared repository facts still use repository knowledge.

Optional supersession must identify the same agent and layer. Raw prompts, hidden reasoning, credentials, and provider-native session state are not promoted.

`agent.context.handoff.recorded` requires distinct source and active successor agents, one to 32 exact source-owned entry IDs, a content-addressed manifest, and record time. Retirement makes the namespace read-only. Nothing is inherited implicitly from a role, parent, team, provider, or prior bot; a successor sees only an explicit handoff.

Both events retain identifiers, hashes, byte counts, layer, and time. Summary and manifest bytes remain in local CAS. Redaction rejects extra fields and invalid content-addressed coordinates. Missing source, mismatched hash or artifact, failed review, stale supersession, invalid successor, or damaged projection causes the mutation or managed response to fail closed rather than silently drop context.

Lervo adds a surface-neutral organization operating report and bounded CEO policy decision:

- Each repository independently projects its immutable organization/team binding, roster, deployments, channel and deliberation counts, active agent-context count, event head, and current workstream.
- A portfolio reader composes snapshots without merging repository authority and explicitly marks organization, team, or project conflicts.
- A CEO decision checks exact appointment, organization, allowlisted action and team, automation depth, observed budget policy/status, operating-report integrity, and approval. It returns `allowed`, `approval_required`, or `denied` without performing the effect.
- The built-in CEO role remains conservative: organization effects require existing approval and adapter boundaries, shell access is denied, and credentials remain outside model context.

Product-host protocol v7 exposes the organization report, context inspection/promotion/handoff, and CEO evaluation as installed local CLI routes. These provide the application boundary for Discord today and a direct Lervo product later. Local operation requires no Hub.

## Consequences

Codex, Claude, and future adapters may execute the same hired agent while reviewed context remains stable and attributable. Repository search, canonical knowledge, relations, current work, and agent context remain independently owned sources selected by one managed context engine. Central products can render and request organization actions without becoming a new authority database.

The CEO decision is not an autonomous external-effect executor. Discord application creation, token issuance, guild installation, and credential custody require platform or human authority outside a model. Adapters may perform allowlisted actions only after a current CEO decision and existing effect authorization.

## References

- [Organization teams and durable hired-agent identities](0386-organization-teams-and-agent-identities.md)
- [Single managed conversation turn](0389-single-managed-conversation-turn.md)
- [Agent organization](../../../architecture/system/agent-organization.md)
- [Product-host protocol](../../../specifications/execution/product-host-protocol.md)
