# ADR-0654: Coordinate every repository by default

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0650](../../../distribution/0650-raise-the-event-writer-target-to-schema-16-after-its-readers.md) (decision 4, which kept the coordination switch off)
Related: [ADR-0652](../../../execution/providers/hooks/0652-refuse-a-write-lervo-could-not-check.md), [Lervo ADE coordination](../../../../specifications/execution/product-surfaces/ade-coordination.md)

## Context

ADR-0650 kept `COORDINATION_STAGE_ENABLED` false until claims, the turn's reconciliation, and retirement had landed. Canaries opened the gate per repository with an owner-only `enabled` file. On 2026-11-28 the owner asked why the switch did not turn on by itself.

The real-repository canary on the Mac lervo checkout then passed all three steps on CLI 0.67.1:

1. Conversation A's write was recorded in its changes file, and its lease widened.
2. Conversation C was refused when it wrote A's file through the served hook, and was allowed its own file.
3. Retiring A, B, and C with their changes cancelled every assignment, removed every workspace record, and emptied the changes directory.

An earlier attempt, conversation B, had passed unchecked under heavy memory pressure. ADR-0652 closed that path: an undecided claim is now refused, never let through.

## Decision

1. **The switch is on.** Every repository whose writer selects schema 16, whose host's hook runtime declares `conversation-workspace-v1`, and that is not Hub-coordinated, coordinates its ADE conversations.
2. **The owner can close the gate.** An owner-only regular file `disabled` in the repository's coordination home closes the gate for that repository. A file that others can read or write, or a link, closes nothing. `LERVO_COORDINATION=1` or `0` still decides first, for tests.
3. **The `enabled` file is no longer read.** Gates that canaries opened stay open, because the default is open.
4. **Cleanup does not depend on the gate.** As before, retiring a conversation and the upgrade's sweep run whatever the gate says.

## Consequences

- Writes in a conversation's worktree are claimed. On a slow host they may wait for the claim (ADR-0652), and a write another conversation holds is refused with its holder named.
- A repository below schema 16, such as one under an owner hold at writer 14, stays inactive, as before.
- Closing the gate is one owner-only file, and removing it reopens the gate. No release or upgrade is needed.
