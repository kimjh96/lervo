# ADR-0051: Evidence-bound specialist roles and high-risk cross-review

- Status: accepted
- Decision date: 2026-08-20

## Context

Researcher, marketer, and designer cannot be prompt-only personas. Their inputs, authority, output, and evaluation must be verifiable before execution, and handoffs cannot assume shared conversation memory. A high-risk producer cannot review its own result, while different provider names alone do not establish independent review.

## Decision

`@lervo/roles` combines `RoleProfile` and `RoleEvaluationBundle` as `RoleDefinition`.

Built-in researcher checks cover provenance, citations, and claim evidence; marketer checks cover brand and claim evidence; designer checks cover tokens and accessibility. Every role declares the current human-facing writing policy (`en` in v1), E3-required documents, explicit capabilities, output schema, project suites, and evidence-bound handoff. Provider selection remains outside the role.

An evaluation bundle binds the role/profile hash, output schema, and sorted checks using `deterministic`, `separate_semantic`, or `project_verification`.

Results bind the producing run and artifact coordinates, bundle and profile hashes, time, and each check's status, evaluator, evaluator run, role, and evidence artifacts. Separate semantic evaluation must use another run. Missing checks are `not_run`; any failure makes the result `failed`; only all-run and all-pass makes it `passed`.

Publication recomputes schema and IDs, requires a passed result for the exact artifact, and rereads CAS bytes, count, hash, and UTF-8. Role evaluation supplements but never replaces `WritingPublicationPermit`.

`HighRiskRoleWorkflow` fixes distinct proposer/decision owner, reviewer, and verifier; profile and bundle hashes; responsibilities; provider rules; all suites; and `DeliberationPolicy`. The maximum is five rounds. Require independent roles and sessions, passed verification, zero blocking objections, and writing permits. Provider diversity alone proves nothing.

Use evaluation status `passed`, `failed`, or `incomplete`, and check status `passed`, `failed`, or `not_run`. Stable failures distinguish profile, bundle, result, publication, and workflow invalidity. Add no global event. Definitions and results do not prove execution, context, publication, deliberation, or convergence. Sharing still requires publication, handoff, and receiver E2/E3.

Results store only artifact IDs and hashes, never source, URLs, prompts, reasoning, payloads, or evaluator error bodies. Evaluator coordinates are machine identities, not people or accounts. Hub synchronization remains opt-in.

Fixtures cover distinct role capabilities and checks, immutable definitions, check ordering and incomplete/failure distinctions, evidence/run/ID tampering, exact CAS publication, and high-risk role/provider/round constraints.

## Consequences

Specialists are executable contracts rather than prose personas and can be extended without changing provider- and platform-neutral publication or deliberation semantics.
