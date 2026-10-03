# Background materialization and Discord delivery

## Background materialization and r158

Lervo's first 215-document normalization spent approximately twenty minutes in event recording and repository verification. During the live journal, a managed conversation repository-context query hit `knowledge_recovery_required`, interrupting Discord responsiveness. Apply later failed with `knowledge_apply_failed`, rolled back, and cleared the journal.

Operational-search fallback handles only that exact recovery error, records the actual search attempt without inventing a knowledge query/relation projection, and fails closed for other unsafe knowledge errors. Real transaction-marker and unrelated unsafe-source tests passed on Mac/Linux, two each. Initially stale Linux test bytes duplicated imports; they now match Mac. The failure artifact identifies no narrower verification cause: stale tests are a plausible contributor, not a proven sole cause. Mac `pnpm quality:check` passed.

Linux r158 archive `sha256:7bbceb7457122d93734a93eab201b52d1b4af22953d4f8e6328e5ddf4f637398` passed standalone verification and installed immutably. Unchanged r155 CLI bytes were copied to a new immutable path solely for the required CLI-path transition; configuration changed only two Discord deliberation CLI bindings. Guarded replacement of exact r157 reported r158 `ready`, PID 3660208, after three identical ready-conversation observations at 04:45:54 UTC. Supervision/sync remained `pending`; live Discord acceptance remained open. Shiflo grant `kstruct_f19ee16473ac9176a03808cd` renewed only expiry to 06:30 UTC. Comparison excluding expiry/review metadata confirmed unchanged Bora-approved Codex-only scope.

## Tarin channel binding

The owner posted `@Tarin` in Discord `#lervo` at 05:03:50 UTC, message `1553995632673296445`. Direct reads found it and Elio bot replies. r158 mapped Elio to `cnv_lervo_central` but omitted that shared conversation from Tarin's seven-channel mapping; the old message did not prove Tarin acceptance. An exact candidate appended only Elio's existing `#lervo` binding to Tarin. Guarded transition validation passed, but candidate preflight initially refused because the canonical organization deployment hash also needed the channel.

After verified stop under the same work freeze, an owner-only operator composition bound canonical deployment, applied the configuration digest transition, and retained predecessor organization rebind for activation rollback. Guarded upgrade completed around 05:21 UTC, PID 3740840, configuration `sha256:c6128cc24f492e7f90d3f8eba007926e26775d244a4907e377172aafb8a9eba5a`. Configuration preflight passed and conversation became ready. Tarin's central cursor was reading older September history; backlog establishes no post-binding human turn or delivery.

Three old Tarin turns failed with `provider_model_unavailable`. Minimal invocation of configured `claude-opus-5-5` returned a Claude session limit resetting at 14:30 Asia/Seoul: an observed account limit, not proof of an invalid model name. The identical invocation after reset succeeded, reported that model's usage, and answered `OK.`. Acceptance still required a fresh post-binding human message and Tarin-authored delivery. Channel-transition/service-manager suites passed 24 tests; `pnpm quality:check`, `pnpm docs:check` (471 documents), and task-base release completion (`intent_pending`) passed.

## Delivered human turn and evidence limits

Fresh owner message `1554002619427463230` arrived at 05:31:36 UTC. Inbox event `cve_83dd3f8a00722b55eb2a84bfe22d87bb5d0da89798a751e9d5852600ee70836e` was decided `respond`; outbox reached `delivered` at 05:32:58 UTC. Direct Discord read found reply `1554002961364033598` by Tarin bot `1546477551898075176`, proving reception, Tarin response, and delivery for that turn.

The answer described old r157/215-document state because WSL workstream remained revision 21 from 03:54 UTC. Revision 22 now records installed state, but no later human turn verified freshness. The exchange establishes neither multi-party conversation nor a quantified latency target.
