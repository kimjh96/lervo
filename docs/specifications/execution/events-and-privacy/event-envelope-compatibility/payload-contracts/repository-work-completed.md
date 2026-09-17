# `conversation.repository_work.completed`

Retains the source conversation event, durable worker, domain-separated provider-session digest, semantic execution profile, allocation reason, explicitly requested model and reasoning effort, request and result content hashes, result byte count, exact Git-work observation revisions, at most 64 repository-relative changed paths and their untruncated count, final workstream coordinate, knowledge and replica dispositions, verification status, and completion time. Each revision hashes the exact Git HEAD plus the sorted non-ignored dirty-path content digests from the same observation used to derive changed paths. Ignored caches and rebuildable projections cannot change this coordinate independently. The profile and reason contain no raw prompt or result text; a null profile identifies legacy or statically routed work rather than inferred classification.

A null model or effort means the adapter default was requested. Neither requested field claims a provider-observed answer identity. `current` proves full lifecycle currency; `baseline_valid` records that pre-existing normalization debt remained while lint stayed valid.

Excludes prompt and result text, raw provider session identity, command transcripts, diffs, credentials, and unrestricted errors.

The Node emits this event for every accepted native repository-work turn after result storage and lifecycle verification:

- Equal before and after revisions require zero changed paths and represent a diagnostic or explicitly authorized external effect without a repository-byte claim.
- Changed bytes additionally require the continued workstream to advance. Configured strict replica parity must also become current; deployments that omit it record `replicaDisposition: not_configured` without claiming replica freshness.

Missing applicable evidence emits no completion event and fails the conversation turn. This managed-process evidence is distinct from `terminal.turn.declared`, which remains specific to directly operated unmanaged provider terminals.
