# ADR-0019: Provider-neutral deliberation and explicit convergence

Status: `accepted`
Decision date: 2026-08-19

## Context

High-risk design, security review, diagnosis, and document migration may need more than one agent draft. Concatenating free-form Codex/Claude conversations cannot reconstruct which evidence each participant read, whether objections were resolved, or whether verification passed. Sharing full conversations or internal reasoning also breaks shared-context and privacy boundaries.

## Decision

### Orchestrated workflow

- Implement deliberation in Run Orchestrator, never inside a provider adapter.
- A `DeliberationPolicy` orders independent proposer, reviewer, verifier, and decision-owner role profiles and managed sessions. Roles may use different or identical providers under the same contract.
- Every participant discovers project documents and prior artifacts as shared context, then creates fresh E2/E3 for current hashes in its own session. Never inherit another role's receipts, full conversation, reasoning, or provider cache.

### Structured exchange

Exchange only `proposal`, `objection`, `revision`, `verification`, and `decision`. Store source in CAS and metadata coordinates for deliberation/run/session/role/round, artifact identity/hash/evidence, predecessor and target claim, objection blocking/resolution, verification suite/status, and decision owner/accepted claims/unresolved objections.

Do not copy prompts, reasoning, full conversations, tool input, or provider payloads into metadata, events, or handoffs. Human-facing artifacts use the existing writing policy and publication gate.

### Fixed termination conditions

Before execution, policy fixes participants/provider-selection rules, decision owner, maximum rounds, required verification suites, blocking-objection rules, and publication conditions. Provider output cannot silently relax them.

- `converged`: schema-valid decision by the owner, all required verification passed, and zero blocking objections.
- `no_consensus`: maximum rounds reached or blocking objections remain. Record last round, unresolved IDs, and reason; choose no winner and promote no knowledge.
- `failed`: provider, telemetry, schema, or artifact failure. Record phase/code and last confirmed artifact; claim no consensus.

Verbal agreement or matching provider answers are insufficient. Deterministic verification wins where possible; human decisions require the named owner's explicit decision.

### Implementation sequence

1. Project verification artifacts — ADR-0024
2. Writing verification and publication gate — ADR-0025
3. Deliberation artifacts/policy schema — ADR-0026
4. Same-provider two-role fixture — ADR-0028
5. Codex/Claude cross-review fixture — ADR-0029
6. Knowledge candidate plus trace/doctor integration — ADR-0030

ADR-0026 defines runtime event allowlists, ADR-0028 the first persistence path, and ADR-0029 real cross-provider enforcement. A free-form `run.completed` result alone never means consensus.

## Consequences

- Provider combinations do not change workflow or evidence semantics.
- Each participant's actual loaded/injected sources remain independently traceable.
- Claims, objections, verification, and decisions are reconstructable without sharing internal reasoning.
- Bounded non-convergence becomes explicit `no_consensus`, not an arbitrary winner.
- Model majority without verification is never verified knowledge.
