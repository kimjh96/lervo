# ADR-0139: Bind the Conversation Queue to Managed Deliberation

- Status: accepted
- Decision date: 2026-08-22

## Context

The queue must return a stable ID before execution, but the existing executor generated a random ID. Allowing arbitrary IDs through the public CLI would permit workspace collisions or cross-project misuse.

## Decision

The internal-only `ExecuteAssignedManagedDeliberation` accepts the queue-assigned ID, expected project ID, repository root, stored policy, and topic. Public `lervo deliberate` remains unchanged and cannot accept IDs.

Immediately after opening storage, the assigned executor compares the manifest project with the expected project. On mismatch, it closes with `deliberation_project_mismatch` before starting plans, workspaces, runtimes, or providers. Otherwise, the existing execution path runs with only ID generation replaced. Existing workspaces still fail exclusive creation.

`createManagedConversationDeliberationExecutionAdapter` creates unique project-to-absolute-root bindings. It converts only leased jobs and passes both coordinates. Results with mismatched IDs or invalid artifact counts are not settled.

Only `converged` or `no_consensus`, the ID, and artifact count enter the queue summary. Bodies, participants, provider results, and raw errors do not. The queue and app depend only on the neutral execution port.

## Consequences

The ID returned to the conversation addresses the actual workspace and event chain. Cross-project mistakes fail before provider execution, and uncertain execution retains ADR-0138's no-replay semantics.
