# Mac-offline source handoff

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

After a deliberate local handoff, the always-on repository Node must have the exact authorized source revision and workstream checkpoint needed to continue while the originating Mac is offline.

Workstream replication transfers bounded continuation metadata, not Git bytes or uncommitted changes.

Completion requires:

- A reviewed source handoff.
- Remote revision verification before command acceptance.
- Divergence handling.
- A later verified hand-back.

The handoff must not silently push, discard, merge, or overwrite user-owned changes.
