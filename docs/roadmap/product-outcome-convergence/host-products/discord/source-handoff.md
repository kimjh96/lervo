# Mac-offline source handoff

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

Outcome: after a deliberate local handoff, the always-on repository Node has the exact authorized source revision and workstream checkpoint needed to continue while the originating Mac is offline.

Workstream replication transfers bounded continuation metadata, not Git bytes or uncommitted changes.

Completion requires a reviewed source handoff, remote revision verification before command acceptance, divergence handling, and a later verified hand-back. It must not silently push, discard, merge, or overwrite user-owned changes.
