# Managed worker execution

Managed worker execution is defined by:

- [Invocation, authority, and repository boundaries](worker/execution.md).
- [Empty-run and reservation-only supersession](worker/supersession.md).

## Completion and observation

The worker defers assignment completion to [independently verified owner completion](assignment-completion.md). [Task observation](task-observation.md) reads actual start, terminal, result, and verification evidence. User publication remains a separate responsibility.
