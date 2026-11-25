# ADR-0019: Provider-neutral deliberation and explicit convergence

- Status: `accepted`
- Decision date: 2026-08-19
- Amended by: [ADR-0460](0460-trigger-tiered-deliberation-at-decision-points.md)

## Context

High-risk design, security review, diagnosis, and document migration may require multiple agent drafts. Concatenated free-form Codex or Claude conversations cannot establish which evidence each participant read, whether objections were resolved, or whether verification passed. Sharing full conversations or internal reasoning also violates shared-context and privacy boundaries.

## Decision

### Orchestrated workflow

- Implement deliberation in Run Orchestrator, never in a provider adapter.
- A `DeliberationPolicy` orders independent proposer, reviewer, verifier, and decision-owner role profiles and managed sessions. Roles may use the same or different providers under one contract.
- Each participant discovers project documents and prior artifacts as shared context, then creates fresh E2/E3 for current hashes in its own session. Roles never inherit another role's receipts, full conversation, reasoning, or provider cache.

### Structured exchange

Exchange only `proposal`, `objection`, `revision`, `verification`, and `decision`. Store source in CAS and metadata coordinates for deliberation, run, session, role, round, artifact identity/hash/evidence, predecessor, target claim, blocking objection and resolution, verification suite/status, and decision owner, accepted claims, and unresolved objections.

Do not copy prompts, reasoning, full conversations, tool input, or provider payloads into metadata, events, or handoffs. Human-facing artifacts use the existing writing policy and publication gate.

### Fixed termination conditions

Before execution, policy fixes participants and provider-selection rules, decision owner, maximum rounds, required verification suites, blocking-objection rules, and publication conditions. Provider output cannot relax them.

- `converged`: the owner produced a schema-valid decision, all required verification passed, and no blocking objections remain.
- `no_consensus`: maximum rounds were reached or blocking objections remain. Record the last round, unresolved IDs, and reason; select no winner and promote no knowledge.
- `failed`: provider, telemetry, schema, or artifact failure. Record the phase/code and last confirmed artifact; claim no consensus.

Verbal agreement and matching provider answers are insufficient. Prefer deterministic verification; human decisions require the named owner's explicit decision.

### Implementation sequence

1. Project verification artifacts — ADR-0024
2. Writing verification and publication gate — ADR-0025
3. Deliberation artifacts/policy schema — ADR-0026
4. Same-provider two-role fixture — ADR-0028
5. Codex/Claude cross-review fixture — ADR-0029
6. Knowledge candidate plus trace/doctor integration — ADR-0030

ADR-0026 defines runtime event allowlists, ADR-0028 the first persistence path, and ADR-0029 real cross-provider enforcement. A free-form `run.completed` result alone never establishes consensus.

## Consequences

Provider combinations do not alter workflow or evidence semantics. Each participant's loaded and injected sources remain independently traceable. Claims, objections, verification, and decisions are reconstructable without internal reasoning. Bounded non-convergence becomes explicit `no_consensus`, and model majority without verification is never verified knowledge.
