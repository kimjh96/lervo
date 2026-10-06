# Owner commands

`lervo knowledge convergence owner status [--json]` prints this host's hash, label, mode, and verdict without contacting the Hub or printing Hub coordinates.

`lervo knowledge convergence owner release [--json]` releases a held Hub lease and makes this host yield for one lease lifetime.

`lervo knowledge convergence owner publish [--json]` runs one knowledge publication now; it never contacts the remote on a non-owner.

Release and publish report a failure code matching `^[a-z][a-z0-9_]{0,127}$`, or `convergence_owner_command_failed`.
