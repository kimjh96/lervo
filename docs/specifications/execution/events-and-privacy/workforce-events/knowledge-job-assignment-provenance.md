# Conversation knowledge-job assignment provenance

A background conversation-knowledge assignment is ordinary workforce state with exclusive `knowledgeJob` provenance. Its version-1 record requires:

- A deterministic job ID, exact completion-event ID and hash, source conversation-event ID, nullable content-bound source-manifest hash, and durable agent ID.
- A workstream ID, current role version and contract hash, scoped expected paths, acceptance criteria, and verification suite.

A null manifest hash means only that a historical `baseline_valid` completion lacks a version-3 source manifest; it never establishes content currency. Routine or topology provenance cannot be combined with `knowledgeJob` provenance.

## Identity and access authority

The assignment ID is deterministic for the project and completion event. Exact replay returns the same record. Changed provenance, role, access mode, path scope, or acceptance contract under that ID is a conflict.

New knowledge-job assignments use `accessMode: read_only`. Expected paths bound source access but do not exclude an overlapping write-path claim. Claiming requires the named active agent, current role and capability binding, scoped paths, and an unexpired assignment lease. Sharing the agent's role or provider does not authorize another agent to take the job.

A read-only lease fails a write-authority check with `assignment_lease_conflict` and does not permit an ordinary writer workspace. After review identifies an authorized canonical target, writing requires a separate narrow write assignment. Historical assignments without `accessMode` retain `write` semantics and are not silently upgraded.

Before provider work, read-only review authority rechecks exact job provenance, the source-path set, verification suites, role, capability, agent, and live lease. Any drift fails without a review or write success claim.

## Events, privacy, and evidence

New `assignment.created` and `assignment.claimed` events retain `accessMode` (`read_only` or `write`) alongside existing bounded IDs, hashes, lease coordinates, and timestamps. A malformed value fails event validation and rolls back the transition.

`assignment.created` retains these coordinates together:

- `knowledgeJobContractVersion`
- `knowledgeJobId`
- `knowledgeCompletionEventId`
- `knowledgeCompletionEventHash`
- `knowledgeSourceConversationEventId`
- `knowledgeSourceManifestHash`
- `knowledgeAgentId`

Missing or malformed coordinates fail event validation and roll back creation.

Neither event includes message text, source paths or bytes, provider output, absolute paths, credentials, or raw errors. Creation and claim prove only assignment provenance and lease ownership. Agent execution, semantic review, integration, and knowledge currency require distinct workspace and knowledge-outcome evidence. A stale source, failed claim, or changed replay is not success.
