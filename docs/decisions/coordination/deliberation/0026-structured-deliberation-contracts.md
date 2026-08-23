# ADR-0026: Structured deliberation contracts and evidence-based convergence

- Status: `accepted`
- Decision date: 2026-08-19

## Context

Before runtime exists, Lervo needs provider-neutral policy, exchange artifacts, and outcomes. Free-form agreement cannot prove per-role context, resolved objections, executed verification, or accountable decision ownership.

## Decision

`@lervo/schemas` publishes `DeliberationPolicy`, five `DeliberationArtifact` kinds, and three `DeliberationOutcome` kinds. `@lervo/deliberation` validates policy, artifacts, history, verification evidence, and outcome semantics without owning providers, event storage, or runtime order.

Before execution, policy fixes role responsibilities, fixed or allowlisted provider selection, one decision owner, maximum rounds, required suites, and writing-publication policy. Independent review/session, owner decision, required verification, and zero unresolved blocking objections are mandatory.

Common artifact metadata binds deliberation, project, policy, round, producer role/run/session/provider, Markdown CAS coordinates, that role's loaded/injected receipts, shared context, predecessor, evidence events, and content-bound writing permit. It contains no source.

- `proposal`: stable claim IDs and current digests
- `objection`: approval or revision request, objection digest, target claim, and blocking status
- `revision`: revised proposal/revision, new claim digest, and resolved objections
- `verification`: actual `VerificationResult`, result-artifact coordinates, suite/status, and verified claim/version digest
- `decision`: owner, accepted claim, passed verification artifacts, and unresolved objections

Roles cannot share a managed run, provider session, or receipts. Approval after revision must come from another role and directly reference the latest version. Verification must match the current claim digest and canonical result artifact.

`converged` requires independent post-revision approval, the owner's final decision, every required suite passing, current-version verification for each accepted claim, and no blocking objections. `no_consensus` has no decision and must truthfully identify maximum-round, unresolved-objection, or failed-verification conditions. `failed` binds the deliberation even before its first artifact and never implies agreement.

### Events

| Event | Allowed payload |
| --- | --- |
| `deliberation.started` | `deliberationId`, `policyId`, `policyHash`, `participantRoleIds`, `maxRounds` |
| `deliberation.artifact.recorded` | deliberation/artifact IDs, kind, round, producer role, CAS artifact ID/hash, writing permit ID |
| `deliberation.completed` | deliberation/outcome IDs, status, last round, decision artifact, unresolved objections, failure phase/code |

ADR-0027 adds per-event schemas; ADR-0028 adds persistence. Exclude prompts, bodies, provider responses or payloads, reasoning, tool input, credentials, and detailed diagnostics. Redaction failure stores no partial event and terminates runtime in `telemetry`. Failure phases are `provider`, `context`, `telemetry`, `artifact`, `writing`, `verification`, and `contract`, with short source-free codes.

Receipt and shared-context IDs alone do not prove E2/E3 or publication access; runtime must compare source stores. Contract validation does not imply execution, persistence, publication, Hub transfer, or knowledge promotion.

### Boundaries and tests

- `@lervo/schemas`: serialization and types
- writing/verification contract packages: canonical evidence only
- `@lervo/deliberation`: provider-neutral integrity
- execution packages: CAS, commands, and evaluation
- orchestrator: sessions, E2/E3/shared-context checks, and event persistence

Fixtures cover the valid proposal → blocking objection → revision → latest approval → verification → owner decision path. They reject missing approval, stale claim/result evidence, false convergence, early round exhaustion, disallowed providers, copied permits, cross-role session/receipt reuse, and unused verification. Event fixtures prove source and provider diagnostics are absent.

## Consequences

Convergence is recomputed from artifacts, not provider prose. The next step connects two independent roles on one provider to real context delivery and event storage.
