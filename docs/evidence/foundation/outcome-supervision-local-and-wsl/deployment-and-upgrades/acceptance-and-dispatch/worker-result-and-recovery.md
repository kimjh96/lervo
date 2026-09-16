# Worker result and recovery evidence

## Completed result and review

Run `run_6dd4614364eb6f91d5a14c688360cd60` completed, passed its installed checker, and produced a 3,344-byte artifact: `sha256:379ff7787020c28584e0f0bc12f1fd2591296213f046dc541727d54fa712548b`. Independent citation-integrity and claim-support checks passed. Writing review required a plain-language explanation of Hub for a mixed audience.

- Review evidence: `sha256:90538f0f13bc592c25f1928e9574749cb021355a53633406e8417e9f0a5c6363`.
- Installed checker binding: `sha256:ad01d52b91d98b8cae82a54f0ce8d6ebeff6dcbaadf54b367738187e85149eec`.

## Historical correction-run observations

Continuation 31 reopened the existing assignment for that correction. Run `run_f91fb364af05def51ad2af41315848c1` retained exactly five observed events: reservation, causality, request, resolution, and role input binding. No adapter start, usage, stop, or terminal event was observed. The parent command reached its deadline before provider start was recorded; this does not prove zero resource use or process absence. Observation: `sha256:d1d733bf4beb0675b08e0e2b269532846091abde4c2886371feb857e5a339601`.

A fresh read-only SQLite inspection on 2026-09-14 KST recorded:

- Reservation: 2026-09-12 23:13:09.182 UTC.
- Request and resolution: 23:13:20.989 UTC.
- Role input binding: 23:13:21.130 UTC.
- Final run event: sequence 10582.

WSL Codex session files observed during the same parent continuation started at 23:07:47 and 23:09:33 UTC. Each recorded task completion and usage by 23:08:03 and 23:10:02, respectively, before this run was reserved. No later session file was found in the 08:00–09:59 KST filename window.

UTC-normalized journal intervals place the incident in Ubuntu boot `d8a3ebc0a47e4c77ab640c5ee80d3859`, spanning 2026-09-11 13:19:13 through 2026-09-13 00:02:53 UTC, not the following boot. Boot `b552af163c2b46f09529bebc40f770ed` began at 2026-09-13 00:03:42 UTC after the Windows reboot. That transition fences processes from the incident instance, but neither the journal nor missing session files supplies a canonical terminal or accounting receipt for the requested run.

The recovery requirement at this checkpoint was to preserve the five events and reservation until a reviewed recovery contract could validate pre-turn interruption and assignment settlement without assuming zero usage.

Continuation 32 confirmed the dispatch receipt. Continuation 33 blocked on `concurrency_exceeded`, `resource_unobserved`, and `usage_unobserved`: `sha256:2d9ea16de626df975e025b9fdf072ea3621717bb7aae4062ae3108c96ad83106`. Existing reservation-only absence recovery cannot cover a requested run. Valid recovery must preserve event history and establish fencing and accounting semantics before another invocation.

The later [canonical settlement](settlement-and-budget.md) added a failure event while preserving the original five events.
