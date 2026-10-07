# Review, apply, and autonomous continuation

## Review and apply

Candidates and shard responses remain ignored local state. Cache identity binds the envelope and compiler build. Plans bind exact candidate bytes and require per-source approval.

Normalization debt is agent work, not a user or reviewer queue (amended 2026-09-26). Documents become pending whenever added or edited after normalization. Every repository-changing agent turn advances one bounded batch, whatever its task. Terminal turns receive it as an agent-owned attention item; Discord repository-work turns receive it in their instructions.

The turn runs `lervo knowledge normalize --scope all-pending --max-provider-calls 8`, compares each candidate with its source, and applies accepted candidates with their exact approval hashes. A candidate that loses meaning remains unapproved and is reported.

A sandboxed provider turn cannot start a nested provider process. Codex repository-work turns run under `codex exec` with no network and a restricted home, so candidate generation inside them stops at the Codex model-input capability probe (amended 2026-09-26).

The Node generates candidates in the background, outside the provider sandbox, using the conversation's configured provider. A Discord turn receives a stored candidate to review with `--candidate <id> --json` and apply with `--candidate <id> --apply <planId>` and its exact approvals; it never runs `--provider`. A turn starting before any candidate exists receives no normalization assignment; a later turn receives the candidate. Applying always requires `--candidate`, including after a terminal `--provider` run.

Apply never reruns the provider. It writes candidates and sharded lifecycle records through the journal, then emits `knowledge.materialization.applied` with `operation=normalize_documents`.

## Planned autonomous continuation

[ADR-0434](../../../decisions/knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) implements independent agent review under an exact repository delegation, followed by authorized background apply and lifecycle verification. Generation grants neither review nor write authority.

The turn-owned review procedure remains current on projects without reviewed version-4 activation and delegation. See the [runtime contract](../../background-knowledge-convergence/runtime.md) for autonomous review/apply and the [authority and completion contract](../../background-knowledge-convergence/authority-and-completion.md) for its design boundary.
