# ADR-0656: Maintain a project without its own Hub credential

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0471](../0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) (owner-host derivation candidates and the unproven fallback)
Related: [ADR-0469](../0469-keep-background-knowledge-continuous-on-every-host.md), [ADR-0466](../0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [fleet continuity](../../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/continuity.md)

## Context

On 2026-11-28 the owner added a new project, `~/Lervo/axli` (`prj_78a954141b41422a`), on the Mac. No Hub principal lists the project, and the host has no `nodes/<projectId>/` credential for it. Owner-host derivation still took the coordinates of another repository on the host, together with that repository's token, as its last candidate. The Hub refused the token with 403. Under ADR-0471, derivation then wrote those coordinates unproven, pinning another project's token path into this repository's state. The host stayed read-only (`knowledge_authority_unavailable`). It reported the same cause twice, as `owner_host_hub_unusable` and `hub_unavailable`, with a remedy suggesting a Hub upgrade the Hub had already had since 0.21.

The project's `.lervo/project.yaml` sets `dataPolicy.hubSyncEnabled: false`, the default `lervo init` writes. Every checkout that the Hub coordinates today sets it to `true`. The owner's rule (`rule_304aa2496fe08f7935fb1c8c`) is that newly created projects get background knowledge maintenance on whichever host runs them.

## Decision

1. **Another project's token is never used.**
   - Owner-host candidates are only the project's own credentials: its Node, its `nodes/<projectId>` configuration, or its token paired with a Hub another repository on the host uses.
   - Without a token, the project is offered that Hub paired with the path where its own token belongs, `nodes/<projectId>/secrets/hub-sync.token` (`absent`).
   - A probe reads host records, which `workspace.read` allows, while the lease needs coordination scope. So no foreign token is used even when the probe succeeds.
   - A configuration that an earlier release derived with another project's `nodes/<projectId>/` token path, proven or not, is moved to this project's own path.
2. **Without Hub sync and its own credential, the host maintains the project standalone.**
   - When the project's `dataPolicy.hubSyncEnabled` is `false` (the `lervo init` default), only its own credentials are candidates. Without one, the host derives standalone and owns the project's knowledge maintenance locally, like a host without any Hub coordinates (invariant 1).
   - Proven own coordinates stay as written, as ADR-0471 requires.
   - The resident reads the project manifest at every reconciliation, and the manifest is part of the inputs that trigger one. A changed data policy therefore applies without a restart or a commit.
3. **With Hub sync on and no credential of its own, the host stays read-only.**
   - When `hubSyncEnabled` is `true`, another host may hold the project's Hub lease, so ADR-0471's rule stands: the host never falls back to standalone while it has Hub coordinates.
   - The host writes its own token path unproven.
   - Without any own candidate, it keeps Hub coordinates it wrote unproven earlier instead of falling back.
   - The coordinates start working once the operator places the token.
4. **One notice names the exact fix.**
   - The finding is `owner_host_hub_unusable` with detail `hub_credential_absent`, raised when the coordinates name this project's own token path and that file does not exist.
   - A failed host-record exchange through the same unusable coordinates no longer adds `hub_unavailable`.
   - A continuity attention item for a credential detail (`hub_credential_absent`, `hub_forbidden`, `hub_unauthorized`, `token_file_unreadable`) is `credentials_missing`. Like every credential notice, including `knowledge_convergence_owner`, it has `requiresUserAction: true`, because only the operator can issue a credential, and `blocking: false`, so every stage that does not need it continues.
   - The remediation names the fix:
     1. On the Hub host, add a principal whose projects list `{destinationId, projectId}` with `sync.write`.
     2. Reload the Hub (SIGHUP, ADR-0159).
     3. Put the token at `nodes/<projectId>/secrets/hub-sync.token`, mode 0600.
   - The alternative is setting `hubSyncEnabled` to `false`. The remediation no longer suggests upgrading the Hub.

## Two owners are possible, and visible

The standalone fence does not give a project a single owner across hosts:

- It reads only this checkout's `HEAD`.
- It counts another host's knowledge commit only within one lease lifetime (30 minutes).
- After that window, the host owns again.

So a project maintained standalone on two hosts keeps two owners. Each host commits its outputs with the `Lervo-Convergence-Host` trailer, and the outputs can conflict when the branches meet. Each output is its own revertible commit, so nothing is overwritten silently, but work is duplicated.

The same happens when Hub sync is off and one host has its own credential. That host coordinates through the Hub, and a host without a credential maintains the project standalone.

Lervo makes this visible instead of changing the fence:

- **`standalone_peer_active` (attention, not blocking).** A standalone host inspects its branch and its upstream's last fetch, without fetching. If another host's knowledge commits appear within the last 7 days, it reports this finding.
- **Remediation for a single owner.** Set `hubSyncEnabled` to `true` and issue every host that runs the project its own Hub credential.

A permanent yield or a tie-break between hosts would change ADR-0466's lease semantics for every standalone host. A host could yield forever to one that had stopped, and it would rely on history that can be stale without a fetch. That is why the fence is unchanged.

## Consequences

- A project added from the ADE with the default data policy gets background knowledge maintenance on its host, with no Hub credential.
- No repository's state names another project's token.
- A project that syncs through the Hub but has no credential of its own is reported once, as a credential notice with the exact fix. Nothing else waits on it.
- Two hosts maintaining one project are reported, together with the configuration that gives the project one owner.
- `lervo hub credential grant` was not added: issuing a principal needs the Hub host's administrator authority, which this change does not take.
