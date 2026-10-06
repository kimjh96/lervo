# ADR-0471: Keep cross-host knowledge ownership safe when Hub coordination fails

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0469](0469-keep-background-knowledge-continuous-on-every-host.md) (owner-host derivation, Hub candidates, delegation continuity), [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (standalone fallback)
Related: [ADR-0470](../../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md)

## Context

The 2026-10-06 rollout of CLI 0.20.0 also showed:

1. When a host had Hub coordinates that the Hub refused (`hub_forbidden`), owner-host derivation kept the checkout `standalone`, and the standalone verdict owns unconditionally. On the Mac, plen and shiflo became standalone owners while WSL held the Hub lease, so two hosts owned the same repositories.
2. Derivation reused lervo's Hub coordinates and token for every repository on the host. Hub credentials are scoped per project, so the Hub refused them.
3. Continuity reconciled only before a cycle. A cycle waits for host-wide full-cycle admission, so with five residents in one process plen's reconciliation was more than ten minutes overdue. One launchd host resident also opened 2 of 5 repositories and idled for over eight minutes, and nothing exposed the stalled scan.
4. `lervo upgrade` rewrote a delegation-bound verification suite. The bound `suiteHash` then no longer matched, renewal failed with `knowledge_authority_unavailable`, and the owner rebound it by hand.
5. Host resident failure lines did not name the repository.

## Decision

### Ownership and continuity

- **No standalone fallback with Hub coordinates.** When candidate Hub coordinates exist but every probe fails, derivation writes Hub mode with the most specific candidate, marked `unproven` in the derivation marker. The lease then reports `unverifiable`, so the host stays read-only and reports `owner_host_hub_unusable` with the cause, and it never owns standalone while another host may hold the lease. Unproven coordinates are probed again at every reconciliation and become proven when the Hub accepts them. Standalone mode remains only for hosts with no Hub coordinates at all (invariant 1).
- **Project credentials first.** A CLI resident's candidates are, in order: the Node registered for the checkout; the Hub block of `nodes/<projectId>/config.json`; this project's `nodes/<projectId>/secrets/hub-sync.token` paired with each Hub another repository on the host uses; and finally those repositories' coordinates as written. `nodes/` sits beside the user state directory, and on Linux also under `$XDG_CONFIG_HOME/lervo/nodes`. Another repository's token is used only if the probe proves it for this project. Otherwise the `hub_forbidden` remedy names the project credential path.
- **Continuity cannot starve.** The resident offers continuity a turn every 60 seconds as well as before each cycle, with one reconciliation in flight at a time. A cycle waiting for host-wide admission no longer delays owner-host derivation or delegation continuity, which stay internally rate-limited.
- **Identity-preserving rebind.** Under an active policy, before any renewal, continuity re-resolves the content hashes of the delegation's bound suite IDs, role IDs, and parent role. If only hashes changed, for example because a managed upgrade rewrote a suite or refreshed a built-in role, continuity applies the rebound delegation through the ordinary plan and apply. Identifiers, roots, providers, ceilings, parent, reviewer, and expiry stay unchanged. It records `knowledge.convergence.delegation.continued` with action `rebound` and source `binding_refresh`. Any changed identifier is a scope change and still needs an owner-reviewed delegation. This adds two enum values to the event payload, so readers deploy first, as for ADR-0469.

### Observability

- The host resident status gains `scan`: `startedAt`, `completedAt`, and the `repositoryRoot` the running scan is admitting. A scan that started more than ten minutes ago and has not completed is stalled. The doctor then reports `host_resident_scan_stalled` (attention) with the restart command, while the 60-second heartbeat keeps proving the process is alive.
- Each host resident failure line names its checkout: `Knowledge convergence failed in <repository root>: <code>`. A scan failure that belongs to no checkout reads `Host knowledge resident scan failed: <code>`.

### Doctor

| Code                         | Severity  | Meaning                                                            |
| ---------------------------- | --------- | ------------------------------------------------------------------ |
| `owner_host_hub_unusable`    | attention | Now also in Hub mode: unproven coordinates keep the host read-only |
| `host_resident_scan_stalled` | attention | The host resident heartbeats, but its scan has not finished        |

## Failure meaning

- A refused or unreachable Hub never makes a host owner. `unverifiable` means no knowledge work and no publication until a probe succeeds.
- A failed rebind keeps the previous delegation and records `delegation_continuation_failed` with the plan's code; continuity retries after 15 minutes.
- A stalled scan finding means the process lives but serves no newly registered checkout; restarting the service is safe because every per-repository lock and lease is released on stop.

## Consequences

- Two hosts can no longer both own a repository because one host's Hub credential is refused.
- A project's own credential is preferred, so per-project Hub scopes need no shared credential grants.
- Bound suite and role refreshes from managed upgrades no longer stop renewal.
- The host log and doctor name the checkout behind each failure or stall.
