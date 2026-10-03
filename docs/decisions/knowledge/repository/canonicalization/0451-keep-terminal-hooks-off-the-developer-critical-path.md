# ADR-0451: Keep terminal hooks off the developer critical path

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0433](0433-own-background-knowledge-for-every-repository-change.md) and [ADR-0450](0450-keep-background-knowledge-out-of-developer-flow.md)

## Context

Claude Code and Codex CLI run the Lervo terminal hook on every prompt (`UserPromptSubmit`) and turn end (`Stop`). On the installed Mac repository, each prompt waited 6.3–9.4 seconds. The hook launched a hidden provider process to project search queries, scanned the whole event log for execution-evidence sources, and hashed about 6,800 files. It then injected about 28 KB, roughly 7,000 tokens, into the conversation:

- The full workstream snapshot.
- A three-kilobyte attention report.
- Disclaimers.
- Whole retrieved documents, often unrelated to the prompt.

Each `Stop` waited another 6.1–6.3 seconds because it rehashed the repository and rescanned the event log.

The injected context also required synchronous bookkeeping after every repository-changing turn: knowledge refresh, a detailed `lervo terminal declare` document, and workstream advancement. ADR-0433 kept that declaration only until the background owner was verified on an installed repository. ADR-0446 through ADR-0450 meet that condition on the Mac repository.

## Decision

- **Compact default.** Prompt context defaults to compact mode:
  - A one-line rule pointer to `lervo knowledge query`, which AGENTS.md already requires before repository changes.
  - Blocking attention items, if any.
  - The workstream title, first next action, and pending user decisions.
  - Each item is bounded, and the context is normally under 2 KB.
- **No hidden provider call.** Compact mode records an empty query projection from the deterministic `lervo.terminal-compact` projector and selects no documents. `LERVO_TERMINAL_CONTEXT=retrieval` restores per-prompt provider projection and document injection unchanged.
- **Persistent snapshot cache.** Terminal snapshots persist the stat-identity hash cache in `.lervo/state/cache/terminal-repository-snapshot.json`. Each capture rehashes only files whose device, inode, size, mtime, or ctime changed. A missing or invalid cache falls back to a full capture with identical semantics.
- **Lazy evidence sources.** `Stop` collects event-log knowledge sources only when it runs repository knowledge inspection.
- **Background-owned turns.** While a background knowledge resident reports healthy, repository-changing turns owe no synchronous turn declaration or knowledge refresh. The prompt says so, and `Stop` raises no declaration issue. Without a healthy resident, the original declaration contract and checks remain.
- **Workstream rule unchanged.** Workstream advancement after repository changes remains an AGENTS.md rule.

## Failure and privacy

This decision adds no event type, state, or failure code. The deterministic compact projector truthfully reports `empty` with zero queries. The snapshot cache stores only paths, stat identities, sizes, and content hashes in private local state, and never stores file contents.

## Verification

Focused tests must show the following:

- Compact prompts never invoke a provider query projector.
- Compact prompts include the workstream headline but no retrieved documents, and stay under 6 KB.
- Retrieval mode keeps the previous terminal integration contract.
- A healthy resident removes only the declaration requirement.
- Persistent snapshots equal full captures, detect changes, and survive a corrupt cache.

Installed verification must measure prompt and `Stop` latency and injected size before and after.
