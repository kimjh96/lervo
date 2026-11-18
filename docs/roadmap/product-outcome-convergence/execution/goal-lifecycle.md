# Durable repository goal lifecycle

State: `wired`

Repository goals have a durable lifecycle instead of disconnected prose.

The verified workstream remains root-goal authority; its assignment DAG remains execution authority. Workstream status and supervised goal completion carry the lifecycle without a second store. [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the read-only operating goal report and its protocol route, which had no invoker.

Preserve explicit workstream completion and false authority flags. Independent nested goals remain unsupported. Automatic supervision topology extends the DAG without changing workstream authority.
