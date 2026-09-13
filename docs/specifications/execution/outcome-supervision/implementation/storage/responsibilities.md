# Canonical responsibility recovery

`SupervisionResponsibilityReader` recovers an assignment's current responsibility from `work.responsibility.bound` events and exact CAS bytes. It is read-only: it does not install duties, resolve leases, or grant execution authority.

- [Recovery and Node admission](responsibilities/recovery.md): hash distinctions, canonical history, admission checks, bounds, and tests.
- [Claim transition](responsibilities/claim-transition.md): responsibility installation at the claimed assignment revision, atomic event recording, failure recovery, and session authority checks.

Automatic topology assignments use the [policy-bound materialization and claim path](../automatic-topology.md).
