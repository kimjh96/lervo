# ADR-0051: Evidence-bound specialist roles and high-risk cross-review

Status: `accepted`
Decision date: 2026-08-20

## Context

Researcher, marketer, and designer cannot be prompt-only personas. Inputs, authority, output, and evaluation must be verifiable before execution; handoffs cannot assume shared conversation memory. A high-risk producer cannot review its own result, and different provider names alone do not establish independent review.

## Decision

- `@lervo/roles` combines `RoleProfile` and `RoleEvaluationBundle` as `RoleDefinition`.
- Built-in researcher checks provenance, citations, and claim evidence; marketer checks brand and claim evidence; designer checks tokens and accessibility.
- Every role declares the current human-facing writing policy (`en` in v1), E3-required documents, explicit capabilities, output schema, project suites, and evidence-bound handoff. Provider selection remains outside the role.
- An evaluation bundle binds role/profile hash/output schema and sorted checks using `deterministic`, `separate_semantic`, or `project_verification`.
- Results bind producing run/artifact coordinates, bundle/profile hashes, time, and every check's status/evaluator/evaluator run/role/evidence artifacts. Separate semantic evaluation must use another run. Missing is `not_run`; any failure makes `failed`; only all-run/all-pass makes `passed`.
- Publication recomputes schema and IDs, requires a passed result for the exact artifact, and rereads CAS bytes/count/hash/UTF-8. Role evaluation supplements, never replaces, `WritingPublicationPermit`.
- `HighRiskRoleWorkflow` fixes distinct proposer/decision owner, reviewer, and verifier; profile/bundle hashes; responsibilities; provider rules; all suites; and `DeliberationPolicy`. Maximum rounds is five. Require independent roles/sessions, passed verification, zero blocking objections, and writing permits. Provider diversity alone proves nothing.

Use evaluation status `passed`, `failed`, `incomplete` and check status `passed`, `failed`, `not_run`. Stable failures distinguish profile, bundle, result, publication, and workflow invalidity. Add no global event; definitions/results do not prove execution, context, publication, deliberation, or convergence. Sharing still requires publication, handoff, and receiver E2/E3.

Results store only artifact IDs/hashes, never source, URLs, prompts, reasoning, payloads, or evaluator error bodies. Evaluator coordinates are machine identities, not people/accounts. Hub sync remains opt-in.

Fixtures cover distinct role capabilities/checks, immutable definitions, check ordering and incomplete/failure distinctions, evidence/run/ID tampering, exact CAS publication, and high-risk role/provider/round constraints.

## Consequences

Specialists are executable contracts rather than prose personas, extensible without changing provider/platform-neutral publication and deliberation semantics.
