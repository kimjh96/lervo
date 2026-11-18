# ADR-0560: Remove unused subsystems to harden the core

Status: `accepted`
Decision date: 2026-11-02
Supersedes, fully or in the named part:

- Search evaluation and engine rollout tooling: ADR-0055, ADR-0056, ADR-0057, ADR-0058, ADR-0059, ADR-0060, ADR-0062, ADR-0064, ADR-0065, ADR-0066, ADR-0067, ADR-0068, ADR-0069, ADR-0070; in the named part: ADR-0053 (assessment), ADR-0061 (selection chain), ADR-0063 (comparison and receipt), ADR-0071 (rollout doctor checks), ADR-0306 (evaluation and rollout).
- Organization deployment and signed node rollout: ADR-0228, ADR-0229, ADR-0230, ADR-0231, ADR-0232, ADR-0233, ADR-0234, ADR-0235, ADR-0236.
- Product host protocol, operating board, governed loop, and unattended scheduling: ADR-0340, ADR-0341, ADR-0355, ADR-0365, ADR-0373, ADR-0374, ADR-0379; in the named part: ADR-0336 (loop), ADR-0337 (approval authority port), ADR-0338 (governed completion path), ADR-0354 (loop token admission), ADR-0361 (product-host attention route), ADR-0399 (scheduler wake-ups), ADR-0418 (product-host composition), ADR-0458 (standing autonomy).
- Slack, native chat, connectors, assignment intake routes, and live webhook triggers: ADR-0342, ADR-0343, ADR-0344, ADR-0347, ADR-0378; in the named part: ADR-0048 (Slack and native chat), ADR-0375 (direct-message trigger), ADR-0380 (topology command and routes).
- Improvement observation and execution performance harnesses: ADR-0339, ADR-0348, ADR-0349, ADR-0357; in the named part: ADR-0346 (local adapter and conformance).
- One-time and exchange tooling: ADR-0144 (identity migration); in the named part: ADR-0171 (OKF exchange), ADR-0206 (README improvement).
- Executive organization control, in the named part: ADR-0390 (organization control), ADR-0393 (organization effects), ADR-0394 (executive adapter), ADR-0412 (repository team creation and executive command).
- Small unused commands, in the named part: ADR-0210 (Hub sharing client), ADR-0212 (`lervo migrate capabilities` alias), ADR-0550 (`lervo knowledge find-replay` route).
  Related: [ADR-0020 product identity](0020-lervo-product-identity.md), [ADR-0452 open collaboration](0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The owner directed on 2026-11-02 that Lervo strengthen its core before widening it: remove what is unused or unnecessary, make Know, Find, Connect, Do, and Surface one loop over one verified relation web, and widen only for observed need.

`docs/product/vision/core-outcomes.md` retains every accepted capability unless a decision supersedes it. This decision supersedes the capabilities below. The evidence was collected on 2026-11-02:

- Event logs of every registered repository on the Mac host and the WSL host. 206 event types are defined; 88 were observed on the Mac host. The WSL host adds work supervision, assignment, role, and organization deliberation events from Discord teams, so those families stay.
- The import graph from the deployed entrypoints (`apps/cli`, `apps/node-runtime`, `apps/hub`).
- Every production invoker of each CLI command: provider hooks, the host knowledge service, the Node runtime, the deploy skill and its scripts, generated `AGENTS.md` instructions, and attention text.

The removal first landed on a branch from 2026-11-02 and was applied again to `main` at revision `124ad123` on 2026-11-18, after 389 newer commits. Before each part was deleted, the invoker scan was repeated on that tree: production code in `apps/cli`, `apps/node-runtime`, and `apps/hub`, scripts, workflows, the deploy skill, and generated instructions name no removed package, module, or command. The installed services were read without changes. The Mac launchd agents run `lervo host upgrade --follow --apply`, `lervo knowledge worker --watch --host`, a Node launcher, and `repository-replica reconcile`. The WSL systemd units run the host follower, the Hub, its forwarding proxy, and Node launchers. No Node configuration on either host sets `organizationCredentials`. The only newer change to a removed module was ADR-0579's removal of runtime retention from `node-fleet-rollback.ts`, whose only importer is the removed organization rollback.

None of the removed parts has a production invoker or observed use. None is a protective feature: each either never ran outside tests and fixtures, or duplicates a path that stays.

## Decision

Remove these subsystems with their CLI commands, packages, tests, and specifications:

| Removed                                                  | Packages and modules                                                                                                                                                                                                                                | Why                                                                                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search evaluation and engine rollout tooling             | evaluation, rollout, engine activation, and retrieval-plan comparison in `packages/search` and `packages/search-local`; `packages/search-adapter-bm25f`; `lervo search engine/rollout/bundle/compare/review/case/assess/evaluate/report/candidates` | Retrieval uses lexical-v2 (ADR-0328). The selection tooling has no invoker. The operational resolver, retrieval plan, observation files, store, and product default stay. |
| Organization deployment and signed node rollout          | `packages/organization-deployment-contract`, `packages/organization-deployment-sqlite`, `packages/organization-credential-source-file`; `lervo repository node rollout`; organization node rollout and rollback modules                             | No invoker and no events. No Node configuration on either host sets `organizationCredentials`. `lervo upgrade` already owns the Node stage.                               |
| Product host protocol, operating board, governed loop    | `packages/product-surface-projection`, `apps/operating-client`; `lervo application` except `attention`; `lervo loop`; unattended scheduler and governed loop services                                                                               | No invoker. Attention stays because terminal health and attention text point to it. The Discord deliberation artifact reader moves to the Node runtime first.             |
| Slack, native chat, connector conformance                | `packages/adapter-slack`, `packages/adapter-native-chat`, `packages/assignment-connector-conformance`                                                                                                                                               | The Node runtime builds only Discord.                                                                                                                                     |
| Live webhook triggers and assignment intake routes       | `packages/live-trigger-sqlite`, `packages/adapter-webhook`; `lervo trigger`; `lervo assignment mention/trigger/connector/topology`; `lervo routine materialize`                                                                                     | No store on any host and no invocation. Contract types that the remaining routine code needs move with it.                                                                |
| Unused knowledge candidates                              | `packages/knowledge` and the diagnostics inspections that read it                                                                                                                                                                                   | No production code writes candidates.                                                                                                                                     |
| Execution performance and reliability harnesses          | `packages/execution-performance`, `packages/execution-reliability`, root `foundation:*` scripts                                                                                                                                                     | Not run by CI or any invoker.                                                                                                                                             |
| Improvement observation                                  | `packages/improvement-observation-local`, `packages/improvement-observation-conformance`                                                                                                                                                            | No importer since its CLI host was removed.                                                                                                                               |
| One-time and exchange tooling                            | `packages/identity-migration` and `lervo migrate identity`; `packages/knowledge-okf` and `lervo knowledge export/import/okf`; README improvement (`lervo readme`)                                                                                   | No invoker. ADR-0529 already removed the OKF upstream pipeline. Public README preservation checks stay.                                                                   |
| Executive organization control and small unused commands | `lervo organization portfolio/ceo-evaluate/executive-execute`, `lervo workforce plan`, `lervo capability publish/pull`, `lervo knowledge impact/refresh-candidate/find-replay`, the `lervo migrate capabilities` alias                              | No invoker or a duplicate of a path that stays.                                                                                                                           |

Kept, with reason:

- Discord conversation, interaction queues, remote commands, policy, deliberation, work supervision, workforce, and roles: observed on the WSL host.
- `lervo research verify`: the `role.research.artifact` verification suite (`.lervo/verifications/role.research.artifact.yaml`) runs it as the checker for managed research runs, so it has a production invoker.
- Hub sync and environment lookup.
- Practice learning (ADR-0543): it landed on 2026-10-31 and has not yet had a chance to produce events, so it is evaluated rather than removed.
- The Hub knowledge graph: it is written on every Hub ingest and moves into the single relation web of the core loop instead of being deleted.

A Node configuration that still sets `organizationCredentials` now fails to start with `invalid_config`, because the exact key list no longer accepts it. No configuration on either host sets it.

Removal happens in batches, one commit each. On the original branch, each batch passed typecheck, quality, architecture, the full test suite, and adversarial review before the next. Applied again to `main`, the batches land in one pull request that GitHub CI verifies. Event types and schema entries stay in `packages/schemas` and the event contract, so hosts and the Hub keep reading stored events of every type and older and newer peers stay compatible. Stored events of removed subsystems stay readable as opaque history, and no stored event is rewritten. Removed specifications are deleted, and each superseded ADR gains a `Superseded by ADR-0560` line.

## Consequences

- Measured against `main` at `124ad123`, `git diff --shortstat` reports 922 files changed, 1,317 insertions, and 77,953 deletions. Production `src` TypeScript lost 48,108 lines and gained 277, a net 47,831 lines or about 13 percent of the 367,943 on that revision. Tests and scripts account for most of the remaining deletions. Build, test, and review time fall.
- ADR-0453 planned to extend `ceo-policy.ts` with principal-mandate actions. That module is removed with the CEO evaluation, so the mandate actions belong in the `principal-decision-policy` that ADR-0453 already names.
- Document normalization records that name deleted documents stay in `.lervo/knowledge/document-normalizations/`. They are reviewed lifecycle records, not rebuildable projections: only a reviewed structure delete or continuation migration retires them.
- ADR-0579 names organization rollouts and rollbacks among the callers of Node onboarding. They are removed here, so `lervo upgrade` and `lervo repository node apply` remain its callers.
- Commands named above stop existing. An owner who needs one later reintroduces it through a new decision tied to an observed need.
- Git history keeps every removed byte, so a removal can be reverted.
- The core loop work (one relation web, one context assembler) and the continuity work (install-and-join CLI, work handoff, same knowledge on every host) start from the smaller surface.

## Verification

- `pnpm typecheck`, `pnpm quality:check`, `pnpm architecture:check`, `pnpm test`, and the distribution smokes pass after each original batch and on the pull request that applies the batches to `main`.
- An import scan finds no reference to a removed package, and `lervo --help` lists no removed command.
- The Discord deliberation path still reads its artifacts on the WSL host after release.
