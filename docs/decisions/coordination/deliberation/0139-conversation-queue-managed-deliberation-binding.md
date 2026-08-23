# ADR-0139: Bind the Conversation Queue to Managed Deliberation

- Status: accepted
- Decision date: 2026-08-22

## Context

The queue must return a stable ID before execution, while the existing executor generated a random ID. Exposing arbitrary IDs in the public CLI would permit workspace collision or cross-project misuse.

## Decision

An internal-only ExecuteAssignedManagedDeliberation accepts the queue-assigned ID, expected project ID, repository root, stored policy, and topic. Public lervo deliberate remains unchanged and cannot accept IDs.

Immediately after opening storage, the assigned executor compares manifest project to expectation. Mismatch closes with deliberation_project_mismatch before plans, workspaces, runtimes, or providers start. Otherwise the existing path runs with only ID generation replaced; existing workspaces still fail exclusive creation.

createManagedConversationDeliberationExecutionAdapter creates unique project-to-absolute-root bindings. It converts only leased jobs and passes both coordinates. Mismatched result IDs or invalid artifact counts are not settled.

Only converged or no_consensus, ID, and artifact count enter the queue summary. Bodies, participants, provider results, and raw errors do not. Queue and app depend only on the neutral execution port.

## Consequences

The ID returned to conversation addresses the actual workspace and event chain, cross-project mistakes fail before provider execution, and uncertain execution retains ADR-0138 no-replay semantics.
