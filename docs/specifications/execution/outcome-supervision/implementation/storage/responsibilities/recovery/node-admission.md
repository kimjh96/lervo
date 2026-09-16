# Node admission

## Authority and responsibility checks

Within its owner session, Node revalidates local mandate authority and reads the canonical responsibility for the readiness adapter's assignment. The adapter's responsibility and latest canonical contract must both match the reviewed action plan. Node uses the recovered canonical document for repository readiness checks and repeats recovery during final execution preflight.

No binding or a changed contract rejects admission with `supervision_readiness_changed`. Other corrupt-history or artifact failures reject recovery. A failure before effect invocation starts produces no execution effect. A typed final-preflight failure retains the recorded decision and reports `supervision_preflight_failed`; replay requires independent proof that the effect never started. Post-invocation failures retain uncertain execution for reconciliation. The effect adapter owns final exact admission at its commit boundary.

## Claim timing

Native initial, revised, and recovery claims reserve a thirty-second admission margin before the absolute task completion deadline. This covers latency between the owner's proposal and the fenced acquisition that rechecks the same deadline. Claims round remaining duration down to whole seconds, cap each claim at five minutes, and reject less than five seconds of usable lease time.

A recovery claim whose successor responsibility can no longer hold that margin plus a minimal lease is not materialized; the owner decides again. The canonical claim boundary still checks actual acquisition and expiry. The allowance does not extend the task deadline.
