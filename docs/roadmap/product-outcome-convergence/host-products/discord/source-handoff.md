# Mac-offline source handoff

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

After a deliberate local handoff, the always-on repository Node must have the exact authorized source revision and workstream checkpoint needed to continue while the originating Mac is offline.

Workstream replication transfers bounded continuation metadata, not Git bytes or uncommitted changes.

Completion requires:

- A reviewed source handoff.
- Remote revision verification before command acceptance.
- Divergence handling without an owner choice ([ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)): a replica conflict saves the losing side to a backup branch before the configured side is applied, and the log names that branch.
- Workstream reconciliation keeps the newest valid head without an owner choice, preserves both predecessor hashes, rejects changed heads, and imports the same successor on Mac, Hub, and WSL; the preserved head restores with `lervo workstream reconcile --restore`. Verify CLI-only checkpoint publication separately from Git replica parity and runtime health.
- A later verified hand-back.

The handoff must not silently push, discard, merge, or overwrite user-owned changes: every replaced side stays on a backup branch, and every reconciliation prints a notice with its undo.

[ADR-0456](../../../../decisions/coordination/sync/0456-hand-off-repositories-atomically-with-a-writer-lease.md) designs the handoff primitive, writer lease, divergence surfacing, and version handshake that complete this outcome. Journey J2 of the [open collaboration platform](../../../open-collaboration-platform.md) is its acceptance gate.
