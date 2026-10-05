# Enrollment and waves

Organization enrollment binds an active delivered credential to the deterministic repository service instance, runtime artifact, local onboarding plan and apply receipt hashes, and three complete online readiness observations. It excludes paths, service bodies, credential sources, and secret material. `offline_ready` suffices only for a bounded registered replacement in the local lifecycle; it cannot establish first organization admission.

A rollout names every enrolled target exactly once. A multi-Node rollout starts with one canary. Each wave grows by at most twofold, contains at most 32 Nodes, and permits zero unavailable Nodes.

Advancement requires the exact target version and artifact, event synchronization, workstream replication, and three consecutive complete readiness observations. Pending evidence holds. Degraded, unavailable, stale, version-mismatched, or artifact-mismatched evidence requires an explicit rollback decision.

Planning, observation, approval, execution, and rollback remain separate. The planner cannot approve its plan; the approver cannot execute the approved action. First-wave execution requires explicit approval. Later execution binds the exact prior ready observation; rollback binds the exact current failed observation. Plans, observations, and approvals claim no service effect.
