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

- `lervo model set <role> <provider>[/<model>][@<effort>]...` replaces one role's routes, in order;
- `lervo model unset <role>` returns it to the default.

A role without routes keeps today's behavior: the provider CLI's default model and the effort each caller used before. Background work keeps effort `low`.

A role with routes uses each route's model and effort. A route without an effort uses the role's default: `low` for background work, `high` for reasoning and review, and the provider default for routine work. For reasoning and review, `high` is also the floor. A set reasoning or review role keeps that floor even for a provider the caller names and the role does not list.

Callers read the selection when they make a provider call, not when their process starts. A Node or resident therefore needs no restart, no rebind and no re-review. The next call uses the new route. A Node keeps one parsed copy and re-reads the file only when its content changes, so an unchanged file costs one `stat`.

### Unavailable providers fall through, and only to listed ones

A route whose provider CLI is not admitted on this host (ADR-0536), or that has no login or quota, is skipped for the next route the role lists.

A provider the role does not list is never tried, probed or spent on, even when a delegation allows it. Setting a role to one provider therefore really removes the other.

When no listed route can run, the call reports `provider_not_admitted`, as when no delegated provider is admitted today. Only work that needs that role waits.

### Authority stays separate from choice

The delegation, the continuity policy and the mandate say _which providers may spend_ under their review hash. They no longer say _which provider to use_.

- A route outside a caller's allowed providers is skipped like an unavailable one. When a role lists only providers the caller may not use, the caller waits (`provider_not_admitted`).
- Removing a provider from the fleet is one `lervo model set` per affected role. The reviewed lists may keep naming it, because naming a provider allows it but never selects it.

### The deployment binding covers identity, not model choice

The organization deployment hash keeps covering the agent's identity, role, command provider and authority. It no longer covers `routing.response.provider` or `routing.response.model`, because those are now a role reference resolved at call time. A model change can therefore never orphan a deployment.

The new hash is schema version 2. A deployment bound earlier keeps its version 1 hash. A Node accepts it while its configuration is unchanged, and binding the same configuration again keeps it rather than replacing it, so an upgrade needs no rebind. A version 1 hash still covers the configured response provider and model, so editing those fields needs one `lervo organization bind-runtime`; changing the selection never does. A later step that removes those fields from configurations rebinds afterwards. Only a new deployment carries version 2. An older CLI cannot validate version 2, so a rollback past this release needs a rebind of agents hired since.

### Same selection on every host

The selection is host state under Lervo's user state directory, outside every repository.

- A Hub-coordinated host publishes its selection to the Hub and adopts a newer one it receives, so Mac and WSL use the same routes.
- The newest selection wins, by its revision and change time.
- A host without a Hub keeps its own.

### Documents describe the mechanism

No document names a current model as a contract. Historical evidence keeps the model it observed, because that is a recorded fact. Configuration and policy documents describe roles and the selection only.

## Slices

- **M1.** The selection record and resolver (`@lervo/execution-contract`), and `lervo model show|set|unset`. Background knowledge work resolves the `background` role at each admission: the role orders the providers the delegation allows, and the admitted provider's route sets the model and the effort. That covers assessment, normalization, freshness, instruction capture, practice and change review. The JSON runner's fixed `low` effort becomes the role's default. The normalizer passes the model only, because it has no effort flag.
- **M2a.** `lervo run` uses the `routine` route for the provider it names. The ADR-0561 cross-checks (plan, owner rule fidelity, and capability install) use the `review` role. A provider the caller names stands, with its route. Otherwise the role's providers are tried in order, and a provider whose CLI cannot start falls through to the next. The capability install's second session takes the next provider the role lists, or the other provider when the role is unset; a second session that gives no verdict is replaced by one of the first provider, as before. A disagreement is never taken to another session. Queries answer only on a provider the `background` role lists, and they keep the provider default model and effort `low`, because the product default search plan is qualified for that projector (ADR-0353); a query model needs requalification first.
- **M2b.** The Node runtime resolves by role at each provider call. Replies and execution profiles use their role, intent resolution uses `routine`, writing and result evaluation use `review`, and a signed remote command keeps its provider and takes the `routine` route for it. A hired agent's provider policy bounds the routes, and a listed provider whose CLI this host cannot start is passed over. Node configuration model fields remain the route of an unset role; nothing rewrites them. The deployment binding stops covering the response model.
- **M2c.** Repository work from a conversation, deliberation participants, and supervision owner reasoning resolve by role.
  - Repository work uses its profile's role, or `routine`. A replayed event, a continued session or a bound agent keeps its provider and takes the role's route for it. Otherwise a set role picks among the providers this Node has an executor for, and new work fails visibly with `provider_not_admitted` when none qualifies.
  - A deliberation seat keeps the provider its reviewed policy fixes and takes the `reasoning` route's model and effort for it. When the role lists that provider at acceptance, the seat's route hash binds the provider with a selection marker instead of a model, so each start or resume uses the current route and a model change never breaks a resume. Any other seat keeps its full hash and resumes unchanged.
  - Owner reasoning keeps its configured provider, which the supervision mandate reviews. Its planned effect records the `reasoning` route's model, and a later selection change never voids it.
- **M3.** Hosts share one selection, in two releases so readers come before writers.
  - The checked-in fleet policy and its reconcile script are removed, and configuration documents stop naming models.
  - Readers: every host record a host publishes for a repository through the Hub may carry its selection. Hub, host and peer validators accept the field, and listing a repository's host records adopts the newest peer selection. An adopted selection keeps its revision and change time, so hosts never adopt each other's copy back. The later change wins, then the higher revision, then the content.
  - Clock safety: a local change is stamped after the selection it replaces, and a peer change stamped more than ten minutes ahead of this host's clock is refused. Change times are strict UTC, and a role a newer Lervo defines travels only in the flat route shape.
  - Host clocks still order changes inside the allowed lead, so two changes less than ten minutes apart on hosts whose clocks disagree may order the wrong way. Ordering by the Hub's accept time is the writer release's choice to make.
  - The whole selection is the unit: two hosts that change different roles before either sees the other keep the later change only. `lervo model show` names the last adoption.
  - Writers: once every host and the Hub run the reader release, each host publishes its selection in its host records and republishes when it changes. A record the Hub rejects is published again without it.

## State, events, privacy, and failure meaning

- **State.** The selection is `{schemaVersion: 1, revision, changedAt, roles: {<role>: [{provider, model, reasoningEffort}]}}`, an owner-only regular file next to the other host state.
  - A missing file means the provider defaults.
  - A file that exists but cannot be read also means the defaults, and `lervo model set` refuses to overwrite it.
  - Roles written by a newer Lervo are kept unchanged when an older one writes another role.
  - A write is a compare-and-swap on the revision, and a concurrent change fails it with `model_selection_changed`.
- **No event per call.** Choosing a route is not an event. The provider call records the requested model, as it does today (`requestedModel`).
- **Change notice (M3).** An adoption from another host leaves a host-local notice with the revisions and change times, and `lervo model show` prints it. It carries no credentials or prompt text. An event for the notice is a later change; it needs an event schema version.
- **Failure meaning.** `provider_not_admitted` from a role means no listed route could run on this host now. It is not a provider failure and never rolls back an upgrade.

## Consequences

- A model or provider change takes one command and no restart, rebind or re-review.
- Background work can use an explicit model and effort instead of whatever default the installed CLI ships. A role left at its defaults behaves exactly as today.
- Reasoning and review may share one provider. Their quality floor, high effort or more, still applies to the routes of those roles.
- Node configuration model fields remain the route of a role left unset.
- A Node checks only that a provider's CLI can start before choosing its route; a provider without a login or quota still fails the call visibly.
- In M1, admission probes a provider without the route's model. A mistyped or unavailable model id therefore fails each background call visibly rather than falling through. M2 probes the route's model at admission.
- A role left unset behaves exactly as before ADR-0612: background calls keep effort `low` and the CLI default model.

## Verification

- **M1.** Set the `background` role to a route whose provider is not admitted on the host, then confirm three things:
  - the next background admission selects the next route's provider and passes that route's model and effort;
  - `lervo model set` changes the route used at the next admission of a running resident without a restart;
  - a role left unset passes no model and effort `low`, as today.
- **M2a.** Set the `review` role to a provider whose CLI cannot start, then a second one; a cross-check runs once on the second with its model and effort. Set `background` to one provider; a query on the other falls back without a provider call. A role left unset keeps the provider the caller names or the resident last admitted, with no model and the effort used before.
- **M2c.** Set `reasoning` during a deliberation, then resume it: the seat keeps its provider and route hash and uses the new model.
- **M2b.** Change the `routine` route while a Node runs, then confirm:
  - the next conversation reply uses it;
  - the Node keeps its process id;
  - the deployment binding stays valid.
- **M3.** Set a role on the Mac and observe the same selection on WSL. Removing the fleet policy leaves every Node configuration reconciled.
