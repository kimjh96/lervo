# ADR-0396: Conflict-safe repository replica continuation

- Status: accepted
- Decision date: 2026-09-10

## Context

Workstream replication let two Nodes agree on the current objective while their Git working trees differed. A Discord product owner could continue an older checkout despite newer uncommitted source on the Mac. Manual copying fixed one occurrence but did not preserve partially typed files, staging state, deletions, or later work in the opposite direction.

Native repository work also incorrectly required an unmanaged provider-terminal declaration to finish the repository lifecycle. Non-interactive Discord-owned provider processes do not execute that local terminal hook, so the conversation runtime rejected changed work even when its workstream and repository knowledge were current.

## Decision

### Exact working replica

A repository replica has five exact coordinates: Git `HEAD`, symbolic branch or detached state, index tree, worktree tree, and a SHA-256 hash over those coordinates. A temporary Git index materializes the worktree tree from every tracked path and every non-ignored untracked path. Syntactically incomplete source such as `const a =` needs no commit, successful build, or provider acknowledgment before replication.

The separate index tree preserves staged versus unstaged state. Deleted paths, executable modes, and symbolic-link modes remain Git tree facts. Git-ignored data is outside this contract: credentials, dependency caches, build outputs, and `.lervo/data` or `.lervo/state` retain their existing owners and are not copied as source.

The Git adapter creates deterministic hidden commits reaching the exact worktree and index trees without changing the user's branch, index, or worktree. A Git bundle transfers these objects through a peer transport. Apply verifies that the target still equals the selected common snapshot, accepts only equal history or a same-branch fast-forward, restores `HEAD`, index, worktree, untracked files, deletions, and modes, then recaptures the snapshot. Apply failure attempts exact rollback; an unprovable rollback is a distinct terminal failure.

### Bidirectional reconciliation

The coordinator stores one bounded common-snapshot hash per configured repository pair outside both repositories:

- Equal sides advance the common receipt.
- If exactly one side differs from the common snapshot, it becomes the source and the other imports it.
- If both sides differ, no bytes are written and the result is `repository_replica_divergent`.
- Initially unequal replicas require explicit one-time reconciliation; normal automation never guesses authority.

The installed peer adapter uses authenticated SSH to the WSL host. The reconciliation contract is transport-neutral: a future Hub artifact transport or first-party Lervo surface can replace SSH without changing snapshot or conflict semantics. Owners control repository roots, peer commands, and interval bounds. Credentials are neither embedded in coordinator state nor emitted in receipts.

Every successful cycle atomically writes a rebuildable `.lervo/state/repository-replica.json` receipt on both sides containing replica ID, exact common/local/peer hashes, status, and time. A repository Node configured with required replica readiness waits for a fresh receipt matching its newly captured local snapshot before native work. After a changed turn, it waits for the new common snapshot before publishing success. Stale, missing, mismatched, or divergent state fails as `repository_replica_not_ready`; it never silently runs against a known stale checkout.

### Native work completion and context

A changed native conversation turn must advance the same current workstream, leave repository knowledge migration, normalization, instruction bridges, and lint current, and reach configured replica parity. The Node verifies these conditions after provider exit rather than delegating completion to a provider prompt or unmanaged terminal hook.

After verification, the Node appends a version 2 `conversation.repository_work.completed` event for every accepted native work turn. It binds:

- Source conversation event and durable worker.
- Domain-separated provider-session digest.
- Explicitly requested model and reasoning effort.
- Request and result content hashes and result byte count.
- Exact before and after repository revisions, bounded changed paths, and total changed-path count.
- Final workstream coordinate, knowledge disposition, replica disposition, verification status, and completion time.

Null requested values mean adapter defaults and never claim a provider-observed answer identity. Equal repository revisions are valid only with zero changed paths, allowing diagnostics and explicitly authorized external effects to retain execution evidence without claiming repository mutation. `current` proves the complete managed knowledge lifecycle. `baseline_valid` reports pre-existing normalization debt while current repository knowledge lint remained valid; it does not claim full migration currency.

The event excludes request text, result text, raw provider session IDs, command transcripts, diffs, credentials, and unrestricted errors. It is absent if applicable checkpoint, knowledge, replica, result-storage, or event-persistence verification fails. Without this event, the native turn cannot be reported as completed.

`terminal.turn.declared` remains the canonical declaration for a directly operated, unmanaged Codex or Claude terminal. It is neither fabricated nor required for a Discord-owned managed conversation process.

Runtime query preparation tolerates syntactically incomplete JSON, YAML, JavaScript, TypeScript, and CSS. If structural extraction fails, it retains the exact whole file as one file-level query unit. Strict knowledge migration and lint remain fail-closed. Thus `const a =` remains discoverable and continuable during live work without weakening canonical repository validation.

The per-worker provider session remains the richest conversational context. Additionally, up to eight prior completed CAS-backed work results are loaded for the same conversation, thread, and durable worker. This survives provider-session loss without sharing one hired agent's history with another. Formal `agent.context.promoted` entries still require qualifying review evidence; a native provider claim alone does not manufacture verified expertise.

## Consequences

Local-to-Discord and Discord-to-local continuation share exact uncommitted source state while the coordinator is healthy. Concurrent independent edits produce a bounded conflict rather than last-writer-wins data loss. Offline work can resume when the peer and coordinator return, but two offline writers require explicit reconciliation.

Replica capture writes only Git objects and Lervo hidden refs. Coordinator state and readiness receipts are rebuildable projections. Git commits, canonical Markdown, workstream snapshots, managed conversation-work completion events, direct-terminal declarations, verification evidence, and agent-context review events retain their existing authority.

## References

- [ADR-0395](0395-resumable-native-repository-work-turns.md)
- [Conflict-safe repository agent workforce](../../execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)
- [Repository Node fleet](../../../roadmap/coordination/repository-node-fleet.md)
- [Agent workspace specification](../../../specifications/execution/agent-workspaces.md)
