# `conversation.repository_work.completed`

Retains the source conversation event, durable worker, domain-separated provider-session digest, explicitly requested model and reasoning effort, request and result content hashes, result byte count, exact repository revisions, at most 64 repository-relative changed paths and their untruncated count, final workstream coordinate, knowledge and replica dispositions, verification status, and completion time.

A null model or effort means the adapter default was requested. Neither requested field claims a provider-observed answer identity. `current` proves full lifecycle currency; `baseline_valid` records that pre-existing normalization debt remained while lint stayed valid.

Excludes prompt and result text, raw provider session identity, command transcripts, diffs, credentials, and unrestricted errors.

The Node emits this event for every accepted native repository-work turn after result storage and lifecycle verification:

- Equal before and after revisions require zero changed paths and represent a diagnostic or explicitly authorized external effect without a repository-byte claim.
- Changed bytes additionally require the continued workstream to advance and configured replica parity to become current.

Missing applicable evidence emits no completion event and fails the conversation turn. This managed-process evidence is distinct from `terminal.turn.declared`, which remains specific to directly operated unmanaged provider terminals.
