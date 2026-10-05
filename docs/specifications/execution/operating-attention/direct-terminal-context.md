# Direct terminal context

Unmanaged Codex and Claude prompt preparation includes the operating attention report digest, counts, coverage, and at most twelve current items. Stale workstream items are excluded and represented only by a count with the `lervo workstream current` inspection command.

Retrieval mode caps this section at 4 KiB; the whole compact context also has a hard 4 KiB budget. Truncation appends a deterministic marker. Preparation uses only the already verified current workstream, its HEAD distance, the bounded canonicalization registry, and the exact repository-lifecycle cache. It performs neither another model call nor a full lifecycle rescan on the prompt path.

The context directs the working agent to resolve in-scope, agent-owned maintenance. It asks the agent to present a question or approval in the same turn only when the listed item is current, user-owned, blocking, and requires user action. A stale approval or decision is never a directive, and hook renderings withhold its text.

The context authorizes no approval, review, repository writes, or external effects. Repeating the current projection on later prompts proves preparation only, not delivery, acknowledgment, or user receipt.
