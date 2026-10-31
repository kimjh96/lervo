# Background reusable-practice learning

Status: `designed`
As of: 2026-10-31

Lervo should learn reusable practice from verified work. [ADR-0533](../../decisions/knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md) removes the unused declaration-driven pipeline while retaining this goal. [ADR-0458](../../decisions/execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md) stays in force and defines the entry and promotion rules. The design follows background instruction capture ([ADR-0467](../../decisions/knowledge/documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md)) and the [core outcomes](../../product/vision/core-outcomes.md) Know layer.

## Completion criteria

- Create a candidate from a single verified observation, in the background (ADR-0458).
- Have an independent reviewer agent, never the generator and not the owner, review each candidate exactly. Promote it on exact review or used-in-practice evidence (ADR-0458). Only a consequential effect reaches the owner.
- Produce repository instructions or portable skills through the appropriate reviewed authority.
- Require no turn declaration.

The design must work locally without a Hub, preserve exact evidence and user-owned content, and never interrupt the developer. Provider behavior stays behind adapters. This item authorizes no implementation or background writes.

[ADR-0543](../../decisions/knowledge/repository/canonicalization/patterns/0543-learn-portable-skills-from-practice-in-the-knowledge-resident.md) is the accepted design: completed, observed turns become practice candidates through the existing capture call; an independent reviewer accepts or rejects them; accepted skills are written under the delegation's scope and published through the knowledge pull request; observed use with coverage drives re-evaluation. It depends on native skill-use observation (ADR-0542) and provider admission (ADR-0536).
