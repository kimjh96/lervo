# Proposals and effects

The model returns a versioned proposal containing `schemaVersion`, `operation`, `rationale`, and JSON-encoded `details`. The host parses bounded output and maps supported operations to exact effects:

- Allocation to observed available staff.
- Scoped hiring.
- Semantic completion preparation.
- Artifact review.
- Bounded rejected-result recovery.
- Accepted-goal completion.

Allocation records grounded staffing alternatives before canonical topology admission. Its blocked assignment acquires the original exact responsibility and lease in a separate decision.

## Native task validation

The shared native task mapper validates the complete `WorkResponsibilityV1` before topology, hire, revision, or recovery planning. Paths follow the canonical exact relative-path contract or use the whole-repository `*` marker; nested globs such as `src/**` are not paths.

Native managed-worker readiness currently maps only `filesystem.read`, `filesystem.write`, and `shell.execute`. Unsupported capabilities and malformed tasks are model-proposal errors eligible for bounded correction described in [reuse](reuse.md), not admitted assignments. Role, mandate, path scope, and actual tool availability remain separately observed at admission and dispatch.

Review and completion bind actual task/result coordinates. Model-provided identifiers cannot replace missing verification or acceptance.

## Escalation contracts

`escalate` has two disjoint detail variants:

- **Local decision need:** requires a bounded lowercase `reasonCode`. It may carry `neededDecision` (up to 1,024 characters) and one to eight `observedNextActions` (up to 512 characters each) as private explanatory evidence. These fields authorize neither work nor external handoff. The original result artifact retains their exact bytes by hash.
- **Scoped escalation:** contains exactly `recipientProjectId` and `request`, and requires observed recipient authority and request validation.

`request_team_support` accepts only the scoped-handoff variant. `accept_team_support` accepts exactly one `handoffHash`. A reason code must never be interpreted as an implicit recipient request.

## Invalid proposals

Malformed or mixed escalation detail shapes produce one `work.owner_attention.v1` effect with `owner_proposal_invalid`; they must not reroute to another effect or throw the same cycle error indefinitely.

An invalid native task first uses bounded owner reasoning correction. Only exhaustion of that bound settles it as the same local attention. Its private bounded rationale references the exact reasoning plan and result hashes; public events carry only the normal bounded reason and hashes.

This attention is a local decision need, not accepted model work or recipient delivery. Planning resumes after the canonical task basis changes, or after the escalation bound, when the principal proxy decides within its mandate ([ADR-0561](../../../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).
