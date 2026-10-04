# ADR-0396: Conflict-safe repository replica continuation

- Status: accepted (amended 2026-09-16)
- Decision date: 2026-09-10

## Context

Workstream replication aligned two Nodes' objectives but not their Git working trees. A Discord product owner could continue an older checkout despite newer uncommitted source on the Mac. Manual copying fixed one occurrence without preserving partially typed files, staging state, deletions, or later work in the opposite direction.

Native repository completion incorrectly required an unmanaged provider-terminal declaration. Non-interactive Discord-owned provider processes do not execute that local hook, so the conversation runtime rejected changed work despite current workstream and repository knowledge.

## Decision

### Exact working replica

A replica has five exact coordinates: Git `HEAD`, symbolic branch or detached state, index tree, worktree tree, and a SHA-256 hash over those coordinates. A temporary Git index materializes the worktree tree from every tracked and non-ignored untracked path. Incomplete source such as `const a =` requires no commit, successful build, or provider acknowledgment before replication.

The separate index tree preserves staged versus unstaged state. Deletions, executable modes, and symbolic-link modes remain Git tree facts. Git-ignored data—including credentials, dependency caches, build outputs, `.lervo/data`, and `.lervo/state`—retains its owners and is not copied as source.

The Git adapter creates deterministic hidden commits reaching the exact worktree and index trees without changing the user's branch, index, or worktree. A Git bundle transfers objects through a peer transport. Apply verifies that the target still equals the selected common snapshot, accepts only equal history or a same-branch fast-forward, restores `HEAD`, index, worktree, untracked files, deletions, and modes, then recaptures the snapshot. Failure attempts exact rollback; unprovable rollback is a distinct terminal failure.

[ADR-0399](../sync/0399-change-driven-repository-and-conversation-work.md) moves export-commit creation from ordinary snapshot observation to bundling and explicit history-replacement recovery. It adds advisory change subscriptions while preserving the exact replica contract.

### Bidirectional reconciliation

The coordinator stores one bounded common-snapshot hash per configured repository pair outside both repositories:

- Equal sides advance the common receipt.
- If exactly one side differs from the common snapshot, it becomes the source and the other imports it.
- If both differ, no bytes are written; the result is `repository_replica_divergent`.
- Initially unequal replicas require explicit one-time reconciliation; normal automation never guesses authority.

The installed peer adapter uses authenticated SSH to the WSL host. The contract is transport-neutral: a future Hub artifact transport or first-party Lervo surface can replace SSH without changing snapshot or conflict semantics. Owners control repository roots, peer commands, and interval bounds. Credentials are neither embedded in coordinator state nor emitted in receipts.

Every successful cycle atomically writes a rebuildable `.lervo/state/repository-replica.json` receipt on both sides with replica ID, exact common/local/peer hashes, status, and time. A repository Node explicitly configured with required replica readiness waits for a fresh receipt matching its newly captured local snapshot before native work. After a changed turn, it waits for the new common snapshot before publishing success. Stale, missing, mismatched, or divergent state fails as `repository_replica_not_ready`; it never silently runs against a known stale checkout.

Required parity is a strict deployment option, not the installed conversation default. An always-on conversation Node normally owns its WSL repository as the single execution writer and omits `repositoryReplica`. The external Mac coordinator may continue producing recovery replicas without gating message admission or result publication; the completion event records `replicaDisposition: not_configured`. Operators enable required parity only with one effective writer, a continuously available coordinator, and an explicit divergence-resolution owner. A known divergent recovery replica remains intact for later review and never authorizes overwriting either side.

### Native work completion and context

A changed native conversation turn must advance the same current workstream and leave repository knowledge migration, normalization, instruction bridges, and lint current. Explicitly configured strict replica readiness also requires replica parity. The Node verifies applicable conditions after provider exit; completion is not delegated to a provider prompt or unmanaged terminal hook.

Replica freshness and the managed completion event are host-owned post-exit gates. Provider instructions require provider-observable checkpoint, knowledge, and verification work but prohibit telling the user that final completion is pending merely because the in-process provider cannot yet observe those later gates. The host publishes the result only after the gates pass; otherwise the ordinary terminal-failure path reports failure. This removes repeated “replica confirmation unavailable, final completion withheld” caveats that offered no actionable choice despite later successful host reconciliation.

After verification, the Node appends a version 2 `conversation.repository_work.completed` event for every accepted native work turn, binding:

- Source conversation event and durable worker.
- Domain-separated provider-session digest.
- Explicitly requested model and reasoning effort.
- Request and result content hashes and result byte count.
- Exact before and after repository revisions, bounded changed paths, and total changed-path count.
- Final workstream coordinate, knowledge disposition, replica disposition, verification status, and completion time.

Null requested values mean adapter defaults, never a provider-observed answer identity. Equal repository revisions are valid only with zero changed paths, allowing diagnostics and explicitly authorized external effects to retain execution evidence without claiming repository mutation. `current` proves the complete managed knowledge lifecycle. `baseline_valid` reports pre-existing normalization debt while current repository knowledge lint remained valid; it does not claim full migration currency.

The event excludes request text, result text, raw provider session IDs, command transcripts, diffs, credentials, and unrestricted errors. It is absent if applicable checkpoint, knowledge, replica, result-storage, or event-persistence verification fails. Without it, the native turn cannot be reported as completed.

`terminal.turn.declared` remains the canonical declaration for a directly operated, unmanaged Codex or Claude terminal. It is neither fabricated nor required for a Discord-owned managed conversation process.

Runtime query preparation tolerates incomplete JSON, YAML, JavaScript, TypeScript, and CSS. If structural extraction fails, it retains the exact whole file as one file-level query unit. Strict knowledge migration and lint remain fail-closed. Thus `const a =` remains discoverable and continuable during live work without weakening canonical repository validation.

The per-worker provider session remains the richest conversational context. Up to eight prior completed CAS-backed work results are also loaded for the same conversation, thread, and durable worker. This survives provider-session loss without sharing one hired agent's history with another. Formal `agent.context.promoted` entries still require qualifying review evidence; a native provider claim alone cannot manufacture verified expertise.

## Consequences

Local-to-Discord and Discord-to-local continuation can share exact uncommitted source while the coordinator is healthy. Concurrent independent edits produce a bounded conflict rather than last-writer-wins data loss. Offline work can resume when the peer and coordinator return, but two offline writers require explicit reconciliation. Installed conversation availability depends on that reconciliation only when an operator deliberately enables strict parity.

Replica observation writes only Git tree objects; bundle creation and explicit recovery additionally write Lervo hidden refs. Coordinator state and readiness receipts are rebuildable projections. Git commits, canonical Markdown, workstream snapshots, managed conversation-work completion events, direct-terminal declarations, verification evidence, and agent-context review events retain their existing authority.

## References

- [ADR-0395](../conversations/0395-resumable-native-repository-work-turns.md)
- [Conflict-safe repository agent workforce](../../execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)
- [Repository Node fleet](../../../roadmap/coordination/repository-node-fleet.md)
- [Agent workspace specification](../../../specifications/execution/agent-workspaces.md)
