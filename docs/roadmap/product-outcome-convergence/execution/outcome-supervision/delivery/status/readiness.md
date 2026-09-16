# Readiness and preflight

Node readiness binding and final preflight are implemented. Raw task observations bind to the combined authority/task digest and require exact responsibility scope. Capability-derived CLI, write, and network-source checks are mandatory.

Node independently checks canonical assignment revisions, leases, worker ancestry, registered Git workspace ownership and state, and the latest responsibility-binding history and CAS artifact.

## Checks and evidence boundaries

Both execution preflights supplement positive application evidence with configured provider and verification-tool version probes and read-only control-repository knowledge-currency inspections. Knowledge inspections require stable, complete scans, no pending normalization, and zero lint issues; they do not prove worker context delivery.

Native Codex and Claude login-status probes supplement positive provider evidence through explicit host profiles and redacted results. Stored-login presence proves neither server authentication nor task-tool permission.

Both preflights inspect verification definitions: every responsibility suite must match trusted host hash pins and use safe working directories. These inspections execute no verification command and do not prove verification success.

Read-only filesystem observations supplement read/write scope evidence for exact plan and responsibility paths in the registered Git workspace. They reject unsafe aliases and repeat before effects. Directory-boundary and Node-process access prove neither worker sandbox nor external-tool permissions.

## Failure and recovery

Final preflight failures retain the recorded decision without claiming uncertain execution. Recovery verification removes an executable between preflights, repairs it, restarts the runtime, and confirms one effect from the original decision.

Replay requires independent non-start evidence. Unavailable inspection and post-invocation failures remain blocking.

Permission-denied provider, tool, and login probes are observed failures. The runtime records one canonical `work.supervision.readiness.failed` per failed-check set and confirms the original decision after host permission repair.

Disposable fixtures cover environment repair, restart recovery, and permission-repair resumption; these fixtures do not prove an installed production journey.

## Remaining step 2 work

Step 2 still requires production responsibility installation, remote authentication and actual task-tool permissions, task-specific knowledge delivery, source-policy, verification, budget, and process observations, and non-Git host composition. Disposable-worktree evidence does not prove that an installed worker can execute.
