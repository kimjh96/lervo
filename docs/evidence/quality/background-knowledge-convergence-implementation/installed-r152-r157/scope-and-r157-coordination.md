# Shiflo scope expansion and r157 coordination

## Shiflo scope boundary

Shiflo's third batch reduced normalization debt to three paths: `.github/pull_request_template.md`, `apps/site/CHANGELOG.md`, and `apps/site/README.md`. Generation correctly stopped `knowledge_authority_unavailable`: these paths were outside the reviewed `docs`, `README.md`, `AGENTS.md`, and `.agents/skills` roots.

Initial approval misspelled `CHANGELOG.md` as `CHANGLELOG.md`; the grant covered the nonexistent spelling and required exact correction. The grant remained present with its reviewed hash, establishing a scope boundary rather than provider failure. Read-only lint was valid with stale lifecycle warnings; a 220-operation generated-only structural migration applied.

Bora approved the three-path expansion. Grant `kstruct_9c409a7ca9b5a65f32c45f2c` retained Codex-only authority and three-document/eight-call/1 MiB/eight-stage ceilings, expiring at 04:45 UTC. Resumed completion/currency remained unobserved then.

## Lervo coordination lock

Lervo review repeatedly failed `coordination_busy`, naming the repository coordination initialization lock. Read-only 100 ms sampling found Node owner/knowledge worker lock activity, including a five-second hold; no persistent lock remained at inspection.

The old 200 attempts × 10 ms could fail during normal multi-second overlap and could not outwait the five-second stale-lock threshold. Acquisition now allows 1,500 attempts with unchanged stale-owner/invalid-lock checks. A live-peer 2.3-second hold/release regression and all 25 storage tests passed on Mac/Linux. Installed root confirmation required rollout.

## r157 rollout and renewed root authority

The Linux r157 archive, SHA-256 `e54f31b694dbfaaf5a4783e005bbcca7b2b1c9b3aa4d364e4d116017a01d2070`, verified/installed. The guarded root upgrade restarted PID 3505507. Its 90-second readiness helper timed out, retaining `readiness_unconfirmed`; three independent later health reads confirmed the same PID, ready conversation/sync, and r157 definition hash. The private recovery receipt was `lervo-r157-readiness-recovered.json`.

Reviews completed at 03:46/03:49 UTC without the earlier `coordination_busy`. After the 03:50 expiry, root grant `kstruct_89529041fa342e34c625d43d` renewed unchanged Codex-only providers, roots, suites, and ceilings through 05:30 UTC. An older-grant generation failed at 03:50:23 UTC with `knowledge_authority_unavailable`; a fresh renewed-grant baseline remained unobserved.

## Exact-path correction and zero counted debt

Shiflo's expansion reduced debt three→one; direct inspection identified `apps/site/CHANGELOG.md`. Bora's prior `apps/site/CHANGLELOG.md` approval did not cover it, so Bora separately approved the exact correction. Grant `kstruct_548031a93d64b5ad1977bc06` retained the ceilings and 04:45 expiry.

Resumed assessment, canonical review, generation, independent review, and apply completed. At 03:58 UTC, direct inspection counted zero canonicalization, normalization, lifecycle, and historical debt, but the baseline was `attention_required/asset_verification_required`, not current.

## Sensitive-local dispositions and later checks

The opaque-asset manifest contained 80 dispositions. Nine exact-hash local-sensitive sources remained unreviewed: two provider settings, three widget-token files, one schema token file, and three SQL migrations.

A private nine-item `sensitive_local` draft retained the ceilings and plan hash `sha256:c426f1daecd824e4747fe8eca63b03e2fac8cdd83475e3856c1e2bf4e28744ef0`; all hashes matched and both JSON files parsed. Bora explicitly approved the exact-hash local-only dispositions; grant `kstruct_5d38773597b1b93db34516d2` applied.

Fresh assessment began with zero normalization/two lifecycle reasons, without complete currency. Concurrent lint refused a live materialization journal; its owner finished event recording and removed it. Later lint had zero issues. Generated-only migration `kplan_a3a4cf44f45564a497fd1dc5` applied four updates; lint again had zero issues.

At 03:56 UTC, Discord still had no new `cnv_lervo_general` human event, only AXLI-team human events.

A later Shiflo canonical review rejected screenshot-root disagreement: the skill allowed configuration, while the canonical store-assets document required `artifacts/app-store/generated`. The skill now requires that root, with portable manifest content hash/version updated together; lint was valid. This change is separate from sensitive-local dispositions and cannot establish lifecycle currency without a fresh successful receipt.
