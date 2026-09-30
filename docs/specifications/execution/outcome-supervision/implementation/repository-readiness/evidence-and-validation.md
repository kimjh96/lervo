# Evidence and validation

Successful probes combine bounded hashes of canonical assignment, ancestry, workspace, and host observations with existing positive lease, ancestry, and workspace evidence. They preserve failed, unobserved, not-required, and missing-evidence application checks. Failed or unavailable repository observations make the corresponding repository checks unobserved while preserving explicit failures.

Each planning or final preflight performs one complete retained-generation and current-workspace proof, then checks exact path access and rereads assignment and ancestry within five seconds. The canonical event head must remain unchanged throughout the probe.

The later managed-effect adapter and worker process each independently repeat the complete workspace proof before starting work. A second historical sweep within one preflight grants no additional authority and must not consume its freshness window. A changed event head, lease, ancestry, path access, or workspace at later admission still blocks execution.

Readiness records exclude raw paths, acceptance prose, native errors, and Git output. No new event, durable projection, or state format is introduced.

Tests provision disposable Git worktrees and exercise real canonical leases, normal dispatch, lease revision changes, absent workspaces, marker drift, foreign paths, and changes between preflights. Missing provider evidence remains blocking even with valid repository observations.
