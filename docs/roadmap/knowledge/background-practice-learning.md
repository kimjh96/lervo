# Background reusable-practice learning

Status: `wired` (standalone host; installed evidence pending)
As of: 2026-10-31

Lervo should learn reusable practice from verified work. [ADR-0533](../../decisions/knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md) removes the unused declaration-driven pipeline while retaining this goal. [ADR-0458](../../decisions/execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md) stays in force and defines the entry and promotion rules. The design follows background instruction capture ([ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md)) and the [core outcomes](../../product/vision/core-outcomes.md) Know layer.

## Completion criteria

- Create a candidate from a single verified observation, in the background (ADR-0458).
- Have an independent reviewer agent, never the generator and not the owner, review each candidate exactly. Promote it on exact review or used-in-practice evidence (ADR-0458). Only a consequential effect reaches the owner.
- Produce repository instructions or portable skills through the appropriate reviewed authority.
- Require no turn declaration.

The implementation works locally without a Hub. It preserves exact evidence and user-owned content. Provider behavior stays behind adapters. Background writes require the reviewed convergence delegation and the current convergence owner.

[ADR-0543](../../decisions/knowledge/repository/canonicalization/patterns/0543-learn-portable-skills-from-practice-in-the-knowledge-resident.md) is the accepted design: completed, observed turns become practice candidates through the existing capture call; an independent reviewer accepts or rejects them; accepted skills are written under the delegation's scope and published through the knowledge pull request; observed use with coverage drives re-evaluation. It depends on native skill-use observation (ADR-0542) and provider admission (ADR-0536).

## Source delivery

The resident reads the verified ADR-0542 transcript range once. It builds a bounded work record and joins it to the next capture only when the session is unambiguous. The timer assesses work after 30 minutes without another owner turn. Practice parsing and persistence cannot fail rule capture.

Separate modules own evidence retention, shapes, catalog comparison, drafting, exact independent review, delegated materialization, publication handoff, usage assessment and budgets. Workforce leases bind the delegation's role and capability hashes. New practice events require schema 8 activation from every configured reader. Older writers retain local observations.

Focused tests cover these paths and the failure boundaries. They were written but not executed, at the owner's request. Source wiring does not establish installed acceptance.

## Bounded exchange follow-up

The Hub typed exchange is not implemented. The sync-contract, Hub sync storage and route adapters, and resident owner transport must implement `/v1/sync/projects/{projectId}/knowledge-skill-candidates` as one bounded follow-up. Exchange candidates, reviews, resolutions and per-host version usage aggregates. Exchange drafts, hashes, digests and provenance only. Never exchange work records, shapes or excerpts. Bind exact reviews to the catalog and target preimage. Merge equivalent practices with different names through reviewer catalog comparison. Revalidate owner authority before materialization. Preserve local assessment on non-owner hosts.

Verification must cover two hosts producing one merged candidate, concurrent updates, stale reviews, unavailable transport, bounded retention and complete host coverage. Until then, Hub-coordinated usage remains unknown and cannot authorize retirement. The focused suite contains an explicit pending exchange acceptance case.

## Installed acceptance

Mac and WSL still need an ordinary directive turn that learns a skill, a separate reviewer session, a knowledge pull request, and a later observed invocation of the exact published version. No installed evidence is claimed.
