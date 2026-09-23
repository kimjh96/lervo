# Proposals and effects

The model returns a versioned proposal with `schemaVersion`, `operation`, `rationale` and JSON-encoded `details`. The host parses bounded output and maps supported operations to exact effects. Current mappings cover:

- Allocation to observed available staff.
- Scoped hiring.
- Semantic completion preparation.
- Artifact review.
- Bounded rejected-result recovery.
- Accepted-goal completion.

Allocation records grounded staffing alternatives, then uses canonical topology admission. Its blocked assignment acquires the original exact responsibility and lease in a separate decision.

Review and completion bind actual task/result coordinates. Model-provided identifiers cannot replace missing verification or acceptance.

`escalate` has two disjoint detail variants. A local decision need has a bounded lowercase `reasonCode`; it may carry `neededDecision` (up to 1,024 characters) and one to eight `observedNextActions` (up to 512 characters each) as private explanatory evidence. These fields do not authorize work or an external handoff; the original result artifact retains their exact bytes by hash. A scoped escalation has exactly `recipientProjectId` and `request` and still requires the observed recipient authority and request validation. `request_team_support` accepts only that scoped-handoff variant; `accept_team_support` accepts exactly one `handoffHash`. A reason code must never be interpreted as an implicit recipient request.

Malformed or mixed detail shapes produce one `work.owner_attention.v1` effect with `owner_proposal_invalid`, rather than rerouting to another effect or throwing the same cycle error indefinitely. Its private bounded rationale references the exact reasoning plan and result hashes; public events carry only the normal bounded reason and hashes. This is a local decision need, not accepted model work, recipient delivery, or a retry permit. A changed canonical task basis is required before planning resumes.
