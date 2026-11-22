# ADR-0612: Choose models by role from one selection

Status: `accepted`
Decision date: 2026-11-22
Amends: [ADR-0536](0536-admit-provider-clis-by-contract.md) (provider choice for background work), [ADR-0393](../../../coordination/conversations/0393-named-agent-identity-and-installed-organization-effects.md) (what the organization deployment binding covers)

## Context

On 2026-11-22 the owner cancelled the Codex subscription. Removing one provider from the fleet then took a whole session:

- six Node configurations on WSL and one on the Mac were edited by hand;
- every edited configuration changed its organization deployment hash, so each Node crash-looped until `lervo organization bind-runtime` rebound it;
- twelve convergence delegation copies and one supervision mandate were re-reviewed;
- the host continuity policy was reinstalled;
- the checked-in fleet policy (`scripts/distribution/po-model-policy.json`) still routes five conversations to Codex, and its reconcile script can only add Codex routes back.

The owner's judgment is that choosing a model should be easy and free, not pinned in documents and copied into files.

An inventory of the code shows where each choice lives today:

- **Concrete model ids live only in Node configurations.** These are `remoteCommands.providerHost.models` and `executionProfiles`, plus the per-conversation fields `routing.intent`, `routing.response`, `routing.evaluation` and `routing.resultEvaluation`, `deliberationParticipation.routes` and `outcomeSupervision.ownerReasoning`. A Node reads them once at start, so a change needs a restart. The deployment binding hashes `routing.response.provider` and `routing.response.model`, so a change also needs a rebind.
- **Everything else picks a provider only and takes the provider CLI's default model.** That covers background knowledge work, `lervo run`, the cross-checks and the terminal hooks. The knowledge JSON runner and the query runner also hardcode effort `low`.
- **Provider lists are copied into reviewed records.** The convergence delegation, the host continuity policy and the supervision mandate each bind their own provider list with a review hash.
- **Nine documents name current models** as if they were contracts.

## Decision

### One selection, read by role

The choice of provider, model and reasoning effort lives in one record, the model selection. It maps each role to an ordered list of routes `{provider, model, reasoningEffort}`. A null model or effort means the provider CLI's default.

| Role         | Used for                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `routine`    | Routine repository work, conversation replies, and intent resolution.                                        |
| `reasoning`  | Reasoning work, owner reasoning in supervision, and deliberation participants.                               |
| `review`     | Native-work review, result evaluation, and the ADR-0561 cross-checks.                                        |
| `background` | Background knowledge work: assessment, normalization, freshness, instruction capture, practice, and queries. |

Every caller names a role and asks the selection which route to use. No configuration, delegation, mandate, policy or document carries a model id.

### Changing it is one command, effective at the next call

`lervo model show` prints the selection. Each role starts from the provider CLI defaults:

- `lervo model set <role> <provider>[/<model>] [--effort <effort>] [--then <provider>[/<model>]]...` replaces one role's routes;
- `lervo model unset <role>` returns it to the default.

Callers read the selection when they make a provider call, not when their process starts. A Node or resident therefore needs no restart, no rebind and no re-review. The next call uses the new route. A Node keeps one parsed copy and re-reads the file only when its content changes, so an unchanged file costs one `stat`.

### Unavailable providers fall through

A route whose provider CLI is not admitted on this host (ADR-0536), or that has no login or quota, is skipped for the next route in the list. Lervo records which route it used and why it skipped the others, as notice-only attention, never as a block. When no route of a role can run, the call reports `model_route_unavailable` with the skipped reasons, and only work that needs that role waits.

### Authority stays separate from choice

The delegation, the continuity policy and the mandate say _which providers may spend_ under their review hash. They no longer say _which provider to use_.

- A route outside a caller's allowed providers is skipped like an unavailable one.
- Removing a provider from the fleet is one `lervo model set` per affected role. The reviewed lists may keep naming it, because naming a provider allows it but never selects it.

### The deployment binding covers identity, not model choice

The organization deployment hash keeps covering the agent's identity, role, command provider and authority. It no longer covers `routing.response.provider` or `routing.response.model`, because those are now a role reference resolved at call time. A model change can therefore never orphan a deployment.

### Same selection on every host

The selection is host state under Lervo's user state directory, outside every repository.

- A Hub-coordinated host publishes its selection to the Hub and adopts a newer one it receives, so Mac and WSL use the same routes.
- The newest selection wins, by its revision and change time.
- A host without a Hub keeps its own.

### Documents describe the mechanism

No document names a current model as a contract. Historical evidence keeps the model it observed, because that is a recorded fact. Configuration and policy documents describe roles and the selection only.

## Slices

| Slice | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1    | The selection record and resolver (`@lervo/execution-contract`), and `lervo model show\|set\|unset`. Background knowledge work resolves the `background` role at each admission: the role orders the providers the delegation allows, and the admitted provider's route sets the model and the effort. That covers assessment, normalization, freshness, instruction capture, practice and change review. The JSON runner's fixed `low` effort becomes the role's default. The normalizer passes the model only, because it has no effort flag. |
| M2    | `lervo run`, the ADR-0561 cross-checks, the query runner and the Node runtime resolve by role at call time. That covers execution profiles, conversations, result evaluation, owner reasoning and deliberation. Node configuration model fields become optional overrides that `lervo upgrade` migrates away once. The deployment binding stops covering model choice.                                                                                                                                                                          |
| M3    | Hub publication and adoption of the selection with a two-host parity check. The checked-in fleet policy and its reconcile script are removed. Configuration documents stop naming models.                                                                                                                                                                                                                                                                                                                                                       |

## State, events, privacy, and failure meaning

- **State.** The selection is `{schemaVersion: 1, revision, changedAt, roles: {<role>: [{provider, model, reasoningEffort}]}}`, written owner-only next to the other host state. A missing or unreadable file means the provider defaults, and an unreadable one is attention.
- **No event per call.** Choosing a route is not an event. The provider call records the requested model, as it does today (`requestedModel`).
- **Change event.** A changed selection is recorded once, as an `application.model_selection.changed` notice with the revision and the roles changed. It holds no credentials and no prompt text.
- **Failure meaning.** `model_route_unavailable` means no route of the role could run on this host now. It is not a provider failure and never rolls back an upgrade.

## Consequences

- A model or provider change takes one command and no restart, rebind or re-review.
- Background work can use an explicit model and effort instead of whatever default the installed CLI ships. A role left at its defaults behaves exactly as today.
- Reasoning and review may share one provider. Their quality floor, high effort or more, still applies to the routes of those roles.
- Until M2 lands, Node configurations keep their own fields. M1 changes only background knowledge work, which picks a provider alone today.
- A role left unset behaves exactly as before ADR-0612: background calls keep effort `low` and the CLI default model.

## Verification

- **M1.** Set the `background` role to a route whose provider is not admitted on the host, then confirm three things:
  - the next background admission selects the next route's provider and passes that route's model and effort;
  - `lervo model set` changes the route used at the next admission of a running resident without a restart;
  - a role left unset passes no model and effort `low`, as today.
- **M2.** Change the `routine` route while a Node runs, then confirm:
  - the next conversation reply uses it;
  - the Node keeps its process id;
  - the deployment binding stays valid.
- **M3.** Set a role on the Mac and observe the same selection on WSL. Removing the fleet policy leaves every Node configuration reconciled.
