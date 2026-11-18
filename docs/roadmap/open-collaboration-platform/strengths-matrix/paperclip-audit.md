# Paperclip audit detail

Verified against `apps/*/src` and `packages/*/src`.

| Adoption | Label | Evidence |
| --- | --- | --- |
| Goal projection (`lervo loop goal`, protocol `operating_goal.inspect`) | `wired` | Unit tests, packed consumer |
| Guild `/goal` to verified result | `installed-proven` (one journey; 13-scenario acceptance open) | `docs/evidence/foundation/outcome-supervision-local-and-wsl/deployment-and-upgrades/discord-successor-preparation/standing-guild-result.md` |
| Operating board, attention, liveness, activity | `wired` (CLI and protocol only) | Unit tests, packed consumer |
| Unified operating view | `contract-only` | None |
| Token usage report; CLI budget stops | `wired`; cost is `not_in_foundation_scope` | `docs/evidence/foundation/managed-execution-resource-budgets-v1.md` lists focused tests only |
| Node supervision token ceiling and owner spend allowance | `installed-proven` | `docs/evidence/foundation/outcome-supervision-local-and-wsl/deployment-and-upgrades/acceptance-and-dispatch/settlement-and-budget.md` |
| Budget warnings to the operator | `contract-only` toward Discord | Node health only |
| Routines; authenticated live webhook | Removed by ADR-0560 | None |
| Scheduler and liveness | `wired` | `docs/evidence/foundation/installed-bounded-unattended-scheduler-v1.md` (fixture provider) |
| Assignment inbox | `wired` (CLI); no Node reference; mention routing and direct-message trigger removed by ADR-0560 | Packed consumer |
| Approval gating | Gating `wired`, granting `contract-only` | No production approval authority port |
| Activity feed | `wired` (protocol v8) | No evidence document |
| Organization portfolio | `wired` | No installed multi-team evidence |
| Slack connector | Removed by ADR-0560 | None |
| Dynamic topology v2 | `wired` through automatic supervision topology; manual CLI route removed by ADR-0560 | `docs/evidence/foundation/installed-bounded-dynamic-execution-graph-v2.md` (temp consumer, fixture; exercised the removed route) |
