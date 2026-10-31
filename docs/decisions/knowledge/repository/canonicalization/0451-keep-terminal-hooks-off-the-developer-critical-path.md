# ADR-0451: Keep terminal hooks off the developer critical path

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0433](0433-own-background-knowledge-for-every-repository-change.md) and [ADR-0450](0450-keep-background-knowledge-out-of-developer-flow.md)
Amended by: [ADR-0530](../../maintenance/0530-keep-background-knowledge-moving-past-divergent-targets.md) (pending normalization is non-blocking attention, never a per-turn duty)

Amended by: [ADR-0531](../../../execution/providers/hooks/0531-bound-terminal-hooks-and-retain-degraded-context.md)

## Context

Claude Code and Codex CLI run the Lervo terminal hook on every prompt (`UserPromptSubmit`) and turn end (`Stop`). On the installed Mac repository, prompts waited 6.3–9.4 seconds while the hook launched a hidden provider process to project search queries, scanned the entire event log for execution-evidence sources, and hashed about 6,800 files. It injected about 28 KB (roughly 7,000 tokens): the full workstream snapshot, a three-kilobyte attention report, disclaimers, and whole retrieved documents often unrelated to the prompt. Each `Stop` added 6.1–6.3 seconds to rehash the repository and rescan the event log.

Injected context also required synchronous knowledge refresh, a detailed `lervo terminal declare` document, and workstream advancement after every repository-changing turn. ADR-0433 retained the declaration only until the background owner was verified on an installed repository; ADR-0446 through ADR-0450 meet that condition on the Mac repository.

## Decision

- **Compact by default.** Prompt context contains a one-line pointer to `lervo knowledge query` (already required by AGENTS.md before repository changes), any blocking attention items, the workstream title, its first next action, and pending user decisions. Each item is bounded; context is normally under 2 KB.
- **No hidden provider call in compact mode.** The deterministic `lervo.terminal-compact` projector records an empty query projection and selects no documents. `LERVO_TERMINAL_CONTEXT=retrieval` restores per-prompt provider projection and document injection unchanged.
- **Persistent snapshot cache.** Terminal snapshots persist the stat-identity hash cache in `.lervo/state/cache/terminal-repository-snapshot.json`. Each capture rehashes only files whose device, inode, size, mtime, or ctime changed. A missing or invalid cache triggers a full capture with identical semantics.
- **Lazy evidence sources.** `Stop` collects event-log knowledge sources only when running repository knowledge inspection.
- **Background-owned turns.** While a background knowledge resident reports healthy, repository-changing turns require no synchronous turn declaration or knowledge refresh. The prompt states this, and `Stop` raises no declaration issue. Without a healthy resident, the original declaration contract and checks remain.
- **Workstream rule unchanged.** AGENTS.md still requires workstream advancement after repository changes.

## Failure and privacy

This decision adds no event type, state, or failure code. The deterministic compact projector truthfully reports `empty` with zero queries. The snapshot cache stores only paths, stat identities, sizes, and content hashes in private local state; it never stores file contents.

## Verification

Focused tests must show:

- Compact prompts never invoke a provider query projector.
- Compact prompts include the workstream headline, contain no retrieved documents, and stay under 6 KB.
- Retrieval mode preserves the previous terminal integration contract.
- A healthy resident removes only the declaration requirement.
- Persistent snapshots equal full captures, detect changes, and survive a corrupt cache.

Installed verification must measure prompt and `Stop` latency and injected size before and after.
