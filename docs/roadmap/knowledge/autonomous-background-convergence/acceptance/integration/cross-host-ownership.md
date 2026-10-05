# Cross-host convergence ownership

- [ ] One convergence owner across hosts under [ADR-0466](../../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md).

Implemented and source-tested with two simulated hosts and a fake Hub lease service. Tests cover:

- Owner and non-owner roles, expiry takeover, and release.
- Hub outage within and beyond a proven lease.
- A recorded failure cause for each Hub client failure code.
- Standalone contention, no non-owner commit, and replica transfer of owner commits.

Installed acceptance remains open:

- Mac and WSL in `hub` mode with one owner.
- Takeover after the owner host stops.
- The Lervo repository back in replica coordination.
- Seven days with one trailer host per lease generation.
