# ADR-0649: Answer knowledge queries past unverifiable evidence

Status: `accepted`
Decision date: 2026-11-27
Amends: [ADR-0176](0176-bounded-verification-result-sources.md)

## Context

In a field canary on installed CLI 0.64.0, an agent in an ADE conversation worktree ran `lervo knowledge query --path notes/canary.md "create a notes file…"` during an open turn. The repository's writer selected event schema 16, and its coordination gate was open. Both attempts exited 1 with `The verification evidence source cannot be verified safely and completely.` The agent then wrote without loading any rule, although `AGENTS.md` requires the query before a write.

The conversation worktree records into the registered repository ([ADR-0633](../providers/hooks/0633-record-a-linked-worktree-in-its-registered-repository.md)). That store held a `verification.completed` event whose suite file was absent from the main checkout. ADR-0176 rejects the whole supplemental corpus when any recorded result cannot be bound to its suite, CAS original, or event. The query collected that corpus before ranking or preparing owner rules, so the failure removed rule loading. The open turn did not cause the failure; every query was affected whenever its evidence root was the registered repository. That covers the main checkout, ordinary linked worktrees, and conversation worktrees. The retry after the turn ran in a process whose registry did not list the repository. It resolved the worktree as its own root and read the worktree's empty store, so it succeeded.

The field event, seeded by the canary, named suite `agent.context`. Ordinary histories leave the same kind of result: a suite added only on a worktree branch, a suite renamed or deleted later, or a pruned CAS original.

## Decision

`lervo knowledge query` collects supplemental evidence through `collectInteractiveKnowledgeSources`, which degrades instead of failing:

- A recorded verification result that cannot be bound to its suite, CAS original, or completion event is omitted and counted. Every result it returns still passes all ADR-0176 bindings.
- When the verification completion history itself cannot be verified, such as conflicting completions of one verification or an unreadable head, all verification results are omitted.
- When the recent execution event window cannot be verified, those events are omitted.
- Repository files, owner rules, and applied instruction context are prepared as before. Storage that cannot open still fails the query.

The query reports omissions instead of silently dropping them. JSON output adds `evidence`, with `verificationResults` as `complete`, `partial` with `omittedCount`, or `omitted`; `executionEvents` is `complete` or `omitted`. Text output prints one `Evidence degraded: …` line for each omitted source, stating that repository files and owner rules are unaffected.

Corpus collectors keep ADR-0176's fail-closed contract: migration, refresh, lint, normalization, structure, instruction intake, terminal lifecycle inspection, and managed search. Their output becomes durable knowledge or gates an effect, so an incomplete corpus must not pass as complete.

## Evidence, privacy, and limits

No event, persistent state, writer schema, or authority is added. `evidence` names only statuses and a count, never suite IDs, paths, hashes, payloads, or result bytes. `partial` means only that the omitted results were not searched, not that they are wrong. It does not prove that the rest of the history is complete.

A focused CLI test starts a real conversation with `workspace start` on schema 16 with the coordination gate open. It records a verification for a suite that exists only in the worktree, opens the turn through the UserPromptSubmit hook, and queries in the worktree and the main checkout. Before this change, the query exited 1 with the field message. Now it exits 0, prints the scoped owner rule, and reports one omitted result. A second test covers conflicting completions. Package tests keep the strict collector failing for the same inputs.

## Responsibility review

`verification-source.ts` owns result binding and the strict-or-omit choice for each result. `knowledge-sources.ts` in `@lervo/repository-context` owns which sources an interactive reader degrades. `knowledge-query-output.ts` owns the printed notes. The query command only composes them, and its length decreases.

## References

- [ADR-0176](0176-bounded-verification-result-sources.md)
- [ADR-0554](0554-bound-what-a-reader-retains-never-history-length.md)
- [Verification result sources](../../../specs/repository-knowledge-compilation/structural-publication/sources/verification-results.md)
