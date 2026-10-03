# Host recovery and evidence-bound claims: r46

On 2026-09-22, Windows remained reachable while its WSL distribution stopped accepting commands. Explicitly approved WSL shutdown/restart restored the Hub and all seven r45 services before rollout.

Commit `2394c079efb67e6b3f724725811f21f24bebaf4d` adds:

- Typed uncertain-effect reporting.
- Bounded supervision-admission retry.
- Host-owned recovery of missing repository-work checkpoints.
- Repository-work routing evidence.
- Evidence-bound connector, configuration, and timestamp claims.

Linux Node distribution `sha256:9a4d8fcd81894776cfce493643473c779cf9acb839a9d1e7e309dfc551846a22` (`runtime-9a4d8fcd-r46`) passed archive verification, smoke verification, and all seven configuration preflights. Exact r45 definitions were copied to owner-only rollback inputs. Lervo, Shiflo, Plen, Flemo, Arca-next, AXLI, and Digimon were upgraded one at a time.

Three consecutive fleet observations found the new executable, matching health PID, and zero restarts on every service. Lervo, Shiflo, Plen, Flemo, Arca-next, and Digimon were overall ready with conversation, sync, workstream replication, and remote control ready. AXLI retained those four ready components; supervision stayed degraded with unchanged `aggregate_budget_exceeded`. No budget was renewed.

The rollout exposed a standalone readiness checker rejecting the documented optional `supervision` projection. Commit `72768c25539b9af792c04f15a71c8d7692264ec3` aligns it with ready, disabled, dormant, and bounded unavailable states. The corrected checker reports the six ready Nodes as ready and AXLI as not ready because aggregate readiness is degraded. Direct bounded health confirms AXLI conversation readiness.

No historical Lervo or Shiflo request was replayed. Each channel still requires a new independently human-authored response acceptance turn.
