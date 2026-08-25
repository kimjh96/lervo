# Provider-entrypoint bootstrap convergence

Status: `complete`
As of: 2026-08-25

## Problem

A repository may contain `CLAUDE.md` without `AGENTS.md`. Onboarding can request canonical AGENTS instructions from the Claude bridge planner before structural migration has created or adopted them. Manual copying unblocks planning, but preserving the user-owned CLAUDE body and appending the managed `@AGENTS.md` import duplicates the shared instructions.

Grouping this bridge change with unrelated README, architecture, or changelog normalization also lets one lossy candidate block exact bridge convergence.

## Outcome

A content-bound onboarding plan establishes canonical provider-neutral instructions before provider bridges are planned. It adopts Claude-only shared instructions without a provider rewrite, preserves genuinely Claude-specific user content, and can converge pure shared content to a thin `@AGENTS.md` bridge through an independent exact disposition. Declining an unrelated document rewrite does not leave the bridge stale.

## Required contract

1. Define bootstrap states for missing, generated, user-owned, and mixed `AGENTS.md` and `CLAUDE.md` inputs. Classify from exact bytes, recorded generation, and managed-block coordinates; filenames alone establish neither ownership nor semantic equivalence.
2. Plan canonical-source establishment, canonical route update, provider-bridge disposition, generated knowledge refresh, and lint in that order. Bind every stage to the same physical repository and exact predecessor hashes. A changed source invalidates later stages.
3. When AGENTS is absent and CLAUDE contains shared instructions, create an exact adoption candidate from the existing bytes plus separately rendered Lervo-owned routes. Establishing the canonical source must not require a semantic provider rewrite.
4. Classify the remaining CLAUDE body as an exact duplicate, provider-specific user content, or unresolved mixed content. Only an exact duplicate may be proposed for removal in a bounded bridge update. Keep provider-specific content in a separate user-owned region; unresolved mixing requires review.
5. Give every user-owned source an independent `accept`, `preserve`, `reject`, or `defer` disposition bound to its input and output hashes. A CLAUDE decision must neither authorize nor depend on changes to READMEs, changelogs, architecture documents, skills, or other normalization items.
6. Treat preservation as a terminal reviewed disposition when canonical instructions and provider discovery are valid. Readiness must not depend on optional prose improvements. Changed source bytes stale only their bound disposition.
7. Keep managed and user-owned blocks disjoint. Replanning and reapplying must be idempotent, must never append a second import or shared body, and must recover safely from interruption between canonical-source and bridge stages.
8. Record bounded lifecycle evidence for state classification, adoption planning, exact approval, preservation or rejection, apply, rollback, and lint. Events exclude document bodies, prompts, provider payloads, credentials, and absolute paths.

## Completion criteria

- A Flemo fixture beginning with user-owned `CLAUDE.md` and no `AGENTS.md` reaches one canonical AGENTS file and one thin Claude bridge without manual copying or duplicated instructions.
- A mixed CLAUDE fixture retains Claude-specific user content while importing AGENTS exactly once.
- Exact duplicate detection is byte-bound and is never inferred from provider output or similar prose.
- Approving or preserving the Claude bridge succeeds independently of rejected or deferred normalization candidates for other documents.
- Safe generated-only stages remain automatic; every deletion or rewrite of user bytes requires separate exact approval.
- Stale-plan, conflicting-edit, interruption, rollback, and immediate-replan tests demonstrate fail-closed convergence.
- `lervo init`, `lervo upgrade`, `lervo migrate knowledge`, terminal status, knowledge refresh, and lint expose the same state and failure meaning.
- Completion requires updating the repository-knowledge specification and recording the durable design in an ADR.

## Dependencies

- [Repository knowledge compilation](../../specs/repository-knowledge-compilation.md)
- [Existing document adoption](../../decisions/knowledge/documents/0018-existing-document-adoption.md)
- [Profiled provider instruction bridge](../../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md)
- [Reviewed document content normalization](../../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
- [Public README migration](../knowledge/public-readme-migration.md)

## Completion evidence

Completed on 2026-08-25 through [ADR-0218](../../decisions/knowledge/repository/0218-content-bound-provider-entrypoint-bootstrap.md). The implementation provides a dedicated canonical-adoption planner and durable apply boundary; exact adopted-duplicate classification; mixed-content preservation; shared migration, refresh, upgrade, and status exposure; and focused fixtures for stale plans, event rollback, unresolved mixing, exact duplicates, mixed content, and CLI convergence. Gemini, Copilot, and other future provider bridges remain separate scope.
