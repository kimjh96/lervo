# Continuity doctor

`lervo knowledge convergence doctor [--json]` inspects every repository in the host registry and Node fleet registry, plus the current one.

It reports delegation, policy, owner-host, lease, publication, resident, hook-runtime, replica, and peer facts with one remediation per finding. It changes no file, reads peers live from the Hub in Hub mode, and exits 1 when any finding needs attention or an owner decision.

See [fleet continuity](../../ownership-and-activation/continuity.md#findings).
