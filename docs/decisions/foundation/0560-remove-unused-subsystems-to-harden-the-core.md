# ADR-0560: Remove unused subsystems to harden the core

Status: `accepted`
Decision date: 2026-11-02
Supersedes, fully or in the named part:

- Search evaluation and engine rollout tooling: ADR-0055, ADR-0056, ADR-0058, ADR-0306 (evaluation and rollout parts).
- Organization deployment and signed node rollout: ADR-0228, ADR-0229, ADR-0230, ADR-0231, ADR-0232, ADR-0233, ADR-0234, ADR-0235, ADR-0236.
- Product host protocol, operating board, governed loop, and unattended scheduling: ADR-0336 (loop part), ADR-0340, ADR-0341, ADR-0355, ADR-0379.
- Slack, native chat, connectors, assignment intake routes, and live webhook triggers: ADR-0343, ADR-0344, ADR-0347, ADR-0378.
- Improvement observation and execution performance harnesses: ADR-0339, ADR-0349, ADR-0357.
- One-time and exchange tooling: ADR-0144 (identity migration), ADR-0171 (OKF exchange), ADR-0206 (README improvement part).
- Executive organization control: ADR-0390 (executive decision part).
  Related: [ADR-0020 product identity](0020-lervo-product-identity.md), [ADR-0452 open collaboration](0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

The owner directed on 2026-11-02 that Lervo strengthen its core before widening it: remove what is unused or unnecessary, make Know, Find, Connect, Do, and Surface one loop over one verified relation web, and widen only for observed need.

`docs/product/vision/core-outcomes.md` retains every accepted capability unless a decision supersedes it. This decision supersedes the capabilities below. The evidence was collected on 2026-11-02:

- Event logs of every registered repository on the Mac host and the WSL host. 206 event types are defined; 88 were observed on the Mac host. The WSL host adds work supervision, assignment, role, and organization deliberation events from Discord teams, so those families stay.
- The import graph from the deployed entrypoints (`apps/cli`, `apps/node-runtime`, `apps/hub`).
- Every production invoker of each CLI command: provider hooks, the host knowledge service, the Node runtime, the deploy skill and its scripts, generated `AGENTS.md` instructions, and attention text.

None of the removed parts has a production invoker or observed use. None is a protective feature: each either never ran outside tests and fixtures, or duplicates a path that stays.

## Decision

Remove these subsystems with their CLI commands, packages, tests, event types, schema entries, and specifications:

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
| Executive organization control and small unused commands | `lervo organization portfolio/ceo-evaluate/executive-execute`, `lervo workforce plan`, `lervo research verify`, `lervo capability publish/pull`, `lervo knowledge impact/refresh-candidate/find-replay`, the `lervo migrate capabilities` alias     | No invoker or a duplicate of a path that stays.                                                                                                                           |

Kept, with reason:

- Discord conversation, interaction queues, remote commands, policy, deliberation, work supervision, workforce, and roles: observed on the WSL host.
- Hub sync and environment lookup.
- Practice learning (ADR-0543): it landed on 2026-10-31 and has not yet had a chance to produce events, so it is evaluated rather than removed.
- The Hub knowledge graph: it is written on every Hub ingest and moves into the single relation web of the core loop instead of being deleted.

Removal happens in batches. Each batch passes typecheck, quality, architecture, the full test suite, and adversarial review before the next. Removed event types leave `packages/schemas` and the event contract. Stored events of removed types stay readable as opaque history, and no stored event is rewritten. Removed specifications are deleted, and each superseded ADR gains a `Superseded by ADR-0560` line.

## Consequences

- About 45,000 source lines, roughly 11 percent, leave the repository. Build, test, and review time fall.
- Commands named above stop existing. An owner who needs one later reintroduces it through a new decision tied to an observed need.
- Git history keeps every removed byte, so a removal can be reverted.
- The core loop work (one relation web, one context assembler) and the continuity work (install-and-join CLI, work handoff, same knowledge on every host) start from the smaller surface.

## Verification

- `pnpm typecheck`, `pnpm quality:check`, `pnpm architecture:check`, `pnpm test`, and the distribution smokes pass after each batch.
- An import scan finds no reference to a removed package, and `lervo --help` lists no removed command.
- The Discord deliberation path still reads its artifacts on the WSL host after release.
