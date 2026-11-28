# ADR-0656: Maintain a project without its own Hub credential

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0471](../0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) (owner-host derivation candidates and the unproven fallback)
Related: [ADR-0469](../0469-keep-background-knowledge-continuous-on-every-host.md), [ADR-0466](../0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [fleet continuity](../../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/continuity.md)

## Context

On 2026-11-28 the owner added a new project, `~/Lervo/axli` (`prj_78a954141b41422a`), on the Mac. No Hub principal lists the project, and the host has no `nodes/<projectId>/` credential for it. Owner-host derivation still took the coordinates of another repository on the host, together with that repository's token, as its last candidate. The Hub refused the token with 403. Under ADR-0471, derivation then wrote those coordinates unproven, pinning another project's token path into this repository's state. The host stayed read-only (`knowledge_authority_unavailable`). It reported the same cause twice, as `owner_host_hub_unusable` and `hub_unavailable`, with a remedy suggesting a Hub upgrade the Hub had already had since 0.21.

The project's `.lervo/project.yaml` sets `dataPolicy.hubSyncEnabled: false`, the default `lervo init` writes. Every checkout that the Hub coordinates today sets it to `true`. The owner's rule (`rule_304aa2496fe08f7935fb1c8c`) is that newly created projects get background knowledge maintenance on whichever host runs them.

## Decision

1. **Another project's token is never pinned.** Candidates record whose credential they carry.
   - Another repository's coordinates, as written, are `foreign`. A probe that proves them for this project still makes them usable, as before. A refused foreign candidate is never written unproven.
   - Without a token of its own, the project is offered the Hub that another repository uses, paired with the path where its own token belongs (`nodes/<projectId>/secrets/hub-sync.token`). That candidate is marked `absent`.
   - The unproven fallback takes only an own or `absent` candidate. Coordinates that Lervo wrote unproven earlier are replaced, so a borrowed token does not stay.
2. **A project that does not sync through the Hub is maintained standalone without its own credential.**
   - When `dataPolicy.hubSyncEnabled` is `false`, only the project's own credentials (its Node, or its `nodes/<projectId>` configuration or token) are candidates.
   - Without one, the host derives standalone and owns the project's knowledge maintenance locally, as a host without any Hub coordinates does (invariant 1).
   - Proven coordinates stay as written, as ADR-0471 requires.
3. **A project that syncs through the Hub stays read-only without its own credential.**
   - When `hubSyncEnabled` is `true`, another host may hold the project's Hub lease, so ADR-0471's rule stands: no standalone fallback.
   - The coordinates name the project's own token path. They start working as soon as the operator places the token; no further derivation is needed.
4. **One notice names the exact fix.**
   - The finding is `owner_host_hub_unusable` with the detail `hub_credential_absent`. A failed host-record exchange through the same unusable coordinates no longer adds `hub_unavailable`.
   - The continuity attention item for a credential detail (`hub_credential_absent`, `hub_forbidden`, `hub_unauthorized`, `token_file_unreadable`) is `credentials_missing`, with `requiresUserAction: false` and `blocking: false`.
   - The remediation names the fix:
     1. On the Hub host, add a principal whose projects list `{destinationId, projectId}` with `sync.write`.
     2. Reload the Hub (SIGHUP, ADR-0159).
     3. Put the token at `nodes/<projectId>/secrets/hub-sync.token`, mode 0600.
   - The remediation also offers the alternative of setting `hubSyncEnabled` to `false`. It no longer suggests upgrading the Hub.

## Two hosts without credentials

A project with `hubSyncEnabled: false` that is cloned on two hosts without its own credential is maintained standalone on both. That is the case ADR-0466 already covers for hosts without a Hub:

- Each host commits its knowledge outputs to its own checkout's base branch, with the `Lervo-Convergence-Host` trailer.
- Once one host's commit reaches the other's base branch, the other host's standalone fence sees a fresh knowledge commit from another host. It turns `contended` and stays read-only, which `convergence-owner.test.ts` covers.
- Until the commits meet, both hosts can produce outputs. Their commits integrate like any two developers' work, and each can be reverted on its own. Duplicate work is possible; silent overwrites are not.
- A project that wants one owner across hosts sets `hubSyncEnabled: true` and gives each host its own credential.

A host with its own credential for a `hubSyncEnabled: false` project keeps Hub coordination. While another host maintains the same project standalone, the standalone host yields after it sees the coordinated host's commits.

## Consequences

- A project added from the ADE with the default data policy gets background knowledge maintenance on its host, with no Hub credential.
- No repository's state names another project's token.
- A project that syncs through the Hub but has no credential is reported once, as a notice with the exact fix, and nothing else waits on it.
- `lervo hub credential grant` was not added: issuing a principal needs the Hub host's administrator authority, which this change does not take.
