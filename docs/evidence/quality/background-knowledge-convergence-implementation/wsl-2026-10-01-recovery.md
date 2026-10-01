# WSL Node supervision and normalization timeout, 2026-10-01

Status: `active`
As of: 2026-10-01T06:26:50Z

## Installed observations

The WSL Lervo Node on `lervo-node-28de5803e2db5aec8bd4ee7d.service` repeatedly reported `supervision_authority_changed` while its standing successor `supervision.discord.standing.s4` had a valid cancelled workstream and no unfinished assignments. An independent read of the successor authority and task snapshot succeeded. The bounded recovery-authority reader now repeats one entire observation after an elapsed-time-only failure; every returned observation still satisfies its own five-second window and exact installation checks. The focused authority suite passed nine tests.

The guarded first service upgrade installed bundle `sha256:2144a93f9aba5242beba8743f40611082eedc206f3eaa657d601d04dc485ea68`. Its Node reached `ready` with conversation, sync, workstream replication, remote control, and supervision all ready at 06:11:10 UTC. The second guarded upgrade installed bundle `sha256:6870e289da9daa193d5681b76f97aa555852309beb395a398f8774d4c9f20114`; systemd reported PID 774510, zero automatic restarts, and the same ready components at 06:26:50 UTC. Both predecessor processes exceeded the 120-second graceful stop and were killed by systemd before their replacements started. Service activation alone is not evidence of repository-wide knowledge currency or a fresh human conversation turn.

The normalization-generation assignment failed at event 59256 at 06:00:36 UTC, before either upgrade. Its private failure proof `sha256:ea45df5195f0675d45b09153a889dfbedb83231a674e1938c0aa0b2b507371ec` records a document normalizer process `timed_out` status. Event 59257 retained `attention_required/knowledge_compile_failed`; read-only inspection later counted 136 pending normalizations, three lifecycle reasons, and no current baseline. The installed second bundle maps only a typed normalizer timeout to the existing transient stage retry, preserving the 16-attempt backoff and shared eight-call batch reservation. Other compile failures remain attention. Focused compiler and failure-mapping suites passed 14 tests; a new live retry and baseline receipt remain to be observed.

## Acceptance boundary

The service has no new human-authored Discord turn after the second bundle upgrade. Human focus, exactly-once routing, and visible Sol/Opus participation remain separate installed checks under ADR-0419. The inactive Arca-next Node retains its separate authority fence.
