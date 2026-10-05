# Inspection

`lervo knowledge convergence status [--json]` and `inspect [--json]` share a read-only storage inspection path. Other trailing arguments are rejected. Both emit JSON; `--json` enables indentation. After storage opens, a finally block attempts to close it.

Inspection reports an error code only if it is a string matching `^[a-z][a-z0-9_]{0,127}$`; otherwise it reports `knowledge_inspection_failed`. This validation is specific to the inspection wrapper.

The status object includes `owner`, the latest [cross-host ownership](../ownership-and-activation/cross-host-ownership.md) verdict from the private fence, or `null` when this host never observed ownership.

`lervo knowledge convergence owner status [--json]` prints this host's hash, label, mode, and verdict without contacting the Hub or printing Hub coordinates. `lervo knowledge convergence owner release [--json]` releases a held Hub lease and makes this host yield for one lease lifetime. `lervo knowledge convergence owner publish [--json]` runs one knowledge publication now; it never contacts the remote on a non-owner. Both report a failure code under the same pattern, or `convergence_owner_command_failed`.
