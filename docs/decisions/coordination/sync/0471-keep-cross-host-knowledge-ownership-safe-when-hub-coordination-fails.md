# ADR-0471: Keep cross-host knowledge ownership safe when Hub coordination fails

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0469](0469-keep-background-knowledge-continuous-on-every-host.md) (owner-host derivation, Hub candidates, delegation continuity), [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (standalone fallback)
Related: [ADR-0470](../../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md)
Amended by: [ADR-0478](0478-renew-each-delegation-with-one-writer.md) (rebind only on the owner, review time kept)

## Context

The 2026-10-06 rollout of CLI 0.20.0 exposed these gaps:

1. When the Hub refused a host's coordinates (`hub_forbidden`), owner-host derivation kept the checkout `standalone`, whose verdict owns unconditionally. Mac plen and shiflo became standalone owners while WSL held the Hub lease, giving the same repositories two owners.
2. Derivation reused lervo's Hub coordinates and token for every repository on the host. The Hub refused these project-scoped credentials.
3. Continuity reconciled only before a cycle, which waits for host-wide full-cycle admission. With five residents in one process, plen's reconciliation was over ten minutes overdue. One launchd host resident opened 2 of 5 repositories and idled for over eight minutes without exposing the stalled scan.
4. `lervo upgrade` rewrote a delegation-bound verification suite, invalidating its bound `suiteHash`. Renewal failed with `knowledge_authority_unavailable`, requiring the owner to rebind it manually.
5. Host resident failure lines omitted the repository.

## Decision

### Ownership and continuity

- **No standalone fallback with Hub coordinates.** If candidate Hub coordinates exist but every probe fails, derivation writes Hub mode with the most specific candidate, marked `unproven` in the derivation marker. The lease reports `unverifiable`; the host stays read-only and reports `owner_host_hub_unusable` with the cause. It never owns standalone while another host may hold the lease. Probe unproven coordinates at every reconciliation and mark them proven when the Hub accepts them. Standalone remains only for hosts with no Hub coordinates at all (invariant 1).
- **Project credentials first.** A CLI resident tries candidates in order: the Node registered for the checkout; the Hub block of `nodes/<projectId>/config.json`; this project's `nodes/<projectId>/secrets/hub-sync.token` paired with each Hub another repository on the host uses; then those repositories' coordinates as written. `nodes/` sits beside the user state directory and, on Linux, also under `$XDG_CONFIG_HOME/lervo/nodes`. Use another repository's token only if the probe proves it for this project. Otherwise, the `hub_forbidden` remedy names the project credential path.
- **Continuity cannot starve.** The resident offers continuity a turn every 60 seconds and before each cycle, with at most one reconciliation in flight. Waiting for host-wide cycle admission no longer delays owner-host derivation or delegation continuity; both remain internally rate-limited.
- **Identity-preserving rebind.** Under an active policy, before renewal, continuity re-resolves content hashes for the delegation's bound suite IDs, role IDs, and parent role. If only hashes changed—for example, a managed upgrade rewrote a suite or refreshed a built-in role—apply the rebound delegation through ordinary plan and apply. Keep identifiers, roots, providers, ceilings, parent, reviewer, and expiry unchanged. Record `knowledge.convergence.delegation.continued` with action `rebound` and source `binding_refresh`. Any changed identifier is a scope change requiring an owner-reviewed delegation. These two event-payload enum additions require readers to deploy first, as for ADR-0469.

### Observability

- Host resident status gains `scan`: `startedAt`, `completedAt`, and the `repositoryRoot` the running scan is admitting. A scan started more than ten minutes ago without completion is stalled. Doctor reports `host_resident_scan_stalled` (attention) with the restart command; the 60-second heartbeat continues proving the process is alive.
- Each host resident failure line names its checkout: `Knowledge convergence failed in <repository root>: <code>`. A scan failure belonging to no checkout reads `Host knowledge resident scan failed: <code>`.

### Doctor

| Code | Severity | Meaning |
| --- | --- | --- |
| `owner_host_hub_unusable` | attention | Also reported in Hub mode: unproven coordinates keep the host read-only. |
| `host_resident_scan_stalled` | attention | The host resident heartbeats, but its scan has not finished. |

## Failure meaning

- A refused or unreachable Hub never makes a host owner. `unverifiable` means no knowledge work or publication until a probe succeeds.
- A failed rebind keeps the previous delegation and records `delegation_continuation_failed` with the plan's code. Continuity retries after 15 minutes.
- A stalled scan means the process lives but serves no newly registered checkout. Restarting the service is safe because every per-repository lock and lease is released on stop.

## Consequences

- Hub credential refusal can no longer cause two hosts to own one repository.
- Preferring a project's own credential avoids shared credential grants for per-project Hub scopes.
- Managed upgrades' bound suite and role refreshes no longer stop renewal.
- The host log and doctor name the checkout behind each failure or stall.
