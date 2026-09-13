# Revocation

Revocation requires the exact mandate hash, installation event, and appointing reviewer. It remains possible after owner suspension or mandate expiry. The revocation event points to the installation; repeated exact revocation returns the existing receipt.

Revocation prevents new admission but does not prove already-started effects stopped. A live owner or an unreleased legacy lease blocks mutation, including revocation. New leases support [process-lock recovery](../../../node-composition/ownership-and-persistence/ownership-and-execution.md) after the owner process terminates. Recovery fences the former owner without settling its effects. Expiry never authorizes takeover. External cancellation remains independent.
