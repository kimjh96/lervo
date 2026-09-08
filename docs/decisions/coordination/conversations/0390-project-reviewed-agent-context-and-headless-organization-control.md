# ADR-0390: Project reviewed agent context and headless organization control

- Status: accepted
- Decision date: 2026-09-09

## Context

Durable hired-agent identity did not by itself preserve reviewed expertise across turns or provider replacement. Discord conversation already used Lervo's product-default repository search, knowledge recommendations, relation projection, context coordinator, managed provider execution, evidence, and budgets, but it had no separately governed agent-context source. A future Lervo product also needed an installed application boundary for organization views and CEO decisions without copying repository truth into a Discord-specific or product-owned database.

## Decision

Lervo adds an agent-ID-keyed, provider-neutral context projection. It is assembled beside repository search for every managed conversation turn and enters the same context selection, loading, injection, and evidence path. Discord does not own or bypass this projection; another conversation surface can reuse the same managed responder.

Only reviewed material can enter durable context. `agent.context.promoted` requires an active hired-agent identity, one `work`, `relationship`, or `expertise` layer, an exact event or CAS artifact source and hash, a CAS summary of at most 32 KiB, an exact qualifying review event and hash, an optional same-agent same-layer supersession coordinate, and promotion time. A `verification.completed` review qualifies only when it passed. Raw prompts, hidden reasoning, credentials, and provider-native session state are not promoted.

`agent.context.handoff.recorded` requires distinct source and active successor agents, one to 32 exact source-owned entry IDs, a content-addressed manifest, and record time. Retirement makes the namespace read-only. Nothing is inherited implicitly from a role, parent, team, provider, or prior bot; a successor sees only an explicit handoff.

Both events retain identifiers, hashes, byte counts, layer, and time. Summary and manifest bytes remain in local CAS. Redaction rejects extra fields and invalid content-addressed coordinates. Missing source, mismatched hash or artifact, failed review, stale supersession, invalid successor, or damaged projection fails the mutation or managed response closed rather than silently dropping context.

Lervo also adds a surface-neutral organization operating report and bounded CEO policy decision:

- Each repository independently projects its immutable organization/team binding, roster, deployments, channel and deliberation counts, active agent-context count, event head, and current workstream.
- A portfolio reader composes those snapshots without merging repository authority and marks organization, team, or project conflicts explicitly.
- A CEO decision checks exact appointment, organization, allowlisted action and team, automation depth, observed budget policy/status, operating-report integrity, and approval. It returns `allowed`, `approval_required`, or `denied`; it does not perform the effect.
- A built-in CEO role remains conservative: organization effects require existing approval and adapter boundaries, shell access is denied, and credentials remain outside model context.

Product-host protocol v7 exposes the organization report, context inspection/promotion/handoff, and CEO evaluation as installed local CLI routes. This is the application boundary for Discord today and a direct Lervo product later. Local operation requires no Hub.

## Consequences

Codex, Claude, and future adapters may execute the same hired agent while reviewed context remains stable and attributable. Repository search, canonical knowledge, relations, current work, and agent context are independently owned sources selected by one managed context engine. Central products can render and request organization actions without becoming a new authority database.

The CEO decision is intentionally not an autonomous external-effect executor. Discord application creation, token issuance, guild installation, and credential custody require platform or human authority outside a model. Adapters may perform allowlisted actions only after a current CEO decision and existing effect authorization.

## References

- [Organization teams and durable hired-agent identities](0386-organization-teams-and-agent-identities.md)
- [Single managed conversation turn](0389-single-managed-conversation-turn.md)
- [Agent organization](../../../architecture/system/agent-organization.md)
- [Product-host protocol](../../../specifications/execution/product-host-protocol.md)
