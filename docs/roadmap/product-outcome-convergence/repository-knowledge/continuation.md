# Continuation across agents, providers, sessions, devices, and clean clones

State: **implemented**.

Workstreams, canonical sources, Hub replication, handoffs, and workspace checkpoints preserve bounded continuation. Provider sessions are replaceable and not generally resumed.

The packed installed continuation journey completes one bounded workstream through Codex, advances its verified revision, rejects a tampered current projection before Claude starts, and resumes through a fresh Claude run and provider session. Both completed runs retain the same workstream identity, exact revision-specific E2/E3 evidence, distinct session coordinates, passing repository verification, and result-digest-bound completion.

This proves repository-evidence continuation across replaceable provider sessions, not native provider-session resume, conversation-memory transfer, live-model quality, or semantic reliance. The [repository knowledge entrypoint](../repository-knowledge.md) links the installed fresh-session cross-provider continuation v1 evidence.
