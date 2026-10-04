# `conversation.repository_work.completed`

The Node emits this event for every accepted native repository-work turn after result storage and lifecycle verification.

The event retains:

- Source conversation event and durable worker.
- Domain-separated provider-session digest.
- Semantic execution profile and allocation reason.
- Explicitly requested model and reasoning effort.
- Request and result content hashes and result byte count.
- Exact Git-work observation revisions.
- At most 64 repository-relative changed paths and their untruncated count.
- Final workstream coordinate, knowledge and replica dispositions, verification status, and completion time.

Each revision hashes the exact Git HEAD and sorted non-ignored dirty-path content digests from the same observation used to derive changed paths. Ignored caches and rebuildable projections cannot independently change this coordinate.

The profile and reason contain no raw prompt or result text. A null profile identifies legacy or statically routed work rather than inferred classification. A null model or effort means the adapter default was requested; neither requested field claims a provider-observed answer identity.

`current` proves full lifecycle currency. `baseline_valid` records that pre-existing normalization debt remained while lint stayed valid.

The event excludes prompt and result text, raw provider session identity, command transcripts, diffs, credentials, and unrestricted errors.

Completion requires:

- Equal before and after revisions have zero changed paths and represent a diagnostic or explicitly authorized external effect without a repository-byte claim.
- Changed bytes require the continued workstream to advance. Configured strict replica parity must also become current. Deployments that omit it record `replicaDisposition: not_configured` without claiming replica freshness.

Missing applicable evidence emits no completion event and fails the conversation turn. This managed-process evidence is distinct from `terminal.turn.declared`, which remains specific to directly operated unmanaged provider terminals.
