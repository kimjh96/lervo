<!-- lervo-release package="@lervo/cli" version="0.62.0" schema="1" -->

## What's changed

- A conversation rebuilt from Claude Code's transcript shows an agent's choice question as its question and the chosen answers as the person's message, not as a tool line.
- A hosted session's shell now shares the Lervo state locations its core was started with, so lervo commands inside a conversation read the same registry and workspaces as the core.
- An agent can start a conversation of its own with lervo workspace start --started-by; it opens from its first turn when the agent's turn ends, at most four an hour per agent.
- An agent paused or retired while a conversation runs is no longer mentioned there: each turn rereads the conversation's team before it ends.
- Carry the caught error as the cause of every error rethrown from a catch block, removing all 133 bulk lint suppressions.
- Each team agent now runs on a model and effort chosen by its role when hired, such as Opus at extra-high effort for a developer, and lervo agent model changes them.
- Hosted Claude sessions in the ADE ask their questions with choices the person picks in the conversation, and the core answers the session host's session.answer through decoder.answer.
- Lervo names each 128 KiB bound once in the contract that owns it (context sources, research inputs, managed task instructions); every bound keeps its value.
- Read event schema 15 in the CLI, the Node, and the Hub: five room events record ADE agents mentioning each other, and terminal.context.prepared may count the owner rules prepared for a turn. Automatic writer activation stays at schema 14.
- Read event schema 16 in the CLI, the Node, and the Hub: assignment.lease.widened and assignment.claim.refused record claims in ADE conversations, and agent.context.promoted may record a conversation_note. Automatic writer activation stays at schema 14.
- Read every operating attention kind through one exhaustive table, so a new kind cannot borrow another kind's fields when the CLI prints attention.
- Replace workforce state and cached-base files through one durable primitive that syncs the file and its directory, so a rename survives a power loss.
- Repository knowledge classifies provider instruction surfaces from one ordered table and derives root surfaces from one registry; classification and normalization results are unchanged.
- Say which registry to use when a linked worktree's workstream events live in the registered repository but this process records into the worktree's own store.
- Sync cached-base files before replacing them, back off after a base that cannot be written, keep delivery markers small, and sweep temporary files a writer left behind.
- The Claude Code adapter reads stream and transcript objects through one shared record check instead of four private copies; behavior is unchanged.
- The terminal hook launcher (version 7) sends a write claim to the resident context server, and when no server takes it, defers it at once without loading the runtime.
- The terminal hook reads a Claude Code PreToolUse call for the paths it writes, the groundwork for claims at first write; until the coordination stage claims them, every write goes ahead as before.
