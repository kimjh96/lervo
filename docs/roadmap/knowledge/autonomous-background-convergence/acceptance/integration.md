# Integration, ownership, and resource limits

- [ ] Preserve user work when writers are live, target bytes are dirty, delegation is revoked, or integration heads change. An accepted branch alone does not satisfy integration.
- [ ] Source replication between hosts with distinct workforce identities preserves each host's reviewed convergence delegation while synchronizing canonical knowledge and asset dispositions.
- [ ] Keep quota/authentication issues, cancellation, missing usage, resource ceilings, exhaustion, and a rejected leading family visible without hot-looping or starving unrelated authorized work.
- [ ] Before assignment, narrow a miss-heavy normalization batch to the largest ordered prefix within the approved provider-call ceiling. Installed verification shows progress without raising that ceiling.
- [ ] Full installed verification runs beyond 30 minutes while its exact assignment lease renews and all four shards settle under [ADR-0359](../../../../decisions/execution/verification/0359-renew-assignment-leases-during-long-verification.md). An expired claim cannot turn failure into success.
- [x] Codex and Claude pass the same review, no-capability, usage, cancellation, and failure contracts. Provider configuration stays behind adapters.
- [x] CLI and Node hosts share ownership. Host-wide resource admission is observed, not inferred from repository-local locks.

## Cross-host convergence ownership

- [ ] One convergence owner across hosts under [ADR-0466](../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md).

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

## Owner publication

- [ ] Settled knowledge reaches the shared remote from whichever host owns convergence under ADR-0466 publication.

Implemented and source-tested against a bare Git remote and a fake pull request host. Tests cover:

- Direct and replayed tips.
- Replay onto a moved base when only knowledge commits exist.
- Supersession of stale commits that conflict with the current base.
- Recreation of an externally closed pull request.
- Merge after passing checks.
- Local fast-forward and the equivalent reset.
- Scope refusal, failed checks, disabled merging, non-owner refusal, and fetch failure.

Installed acceptance remains open: one owner-published pull request merged from each host, with local `main` equal to `origin/main` afterward on both hosts.
