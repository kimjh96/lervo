# Knowledge snapshot identity cache

`apps/cli/src/terminal-compact-context.ts` stores a knowledge snapshot coordinate at `.lervo/state/cache/terminal-knowledge-snapshot.json`, separate from the repository stat-identity and knowledge lifecycle inspection caches.

The record contains schema version 1, repository revision, project ID, policy ID, and source snapshot ID. Reading catches parse and filesystem failures and requires schema version 1 and a source snapshot ID matching `ksnap_` followed by 24 lowercase hexadecimal characters. It does not enforce an exact property set. Reuse also requires matching the requested repository revision and loaded project and policy IDs.

The [shared runtime preparation contract](../../context-quality/runtime-preparation.md) requires reads to use a regular repository file, strict UTF-8, and at most 8 KiB. The cache retains one current identity bound to the exact repository revision, project, and policy.

A miss runs `scanConfiguredRepositoryKnowledge`. Before cache publication, another terminal repository snapshot must match the requested revision. That confirming snapshot ignores the hook's snapshot deadline, so a prompt whose scan overran still publishes the cache for the next prompt. Persistence checks the cache ancestors, creates a private exclusive temporary file, synchronizes it, and replaces the current cache file. It removes its temporary file on failure and sweeps recognized regular temporary files from current and previous naming schemes before writing; unrelated entries remain untouched. Requested directory or file modes alone do not establish the safety or permissions of existing paths.

A linked worktree of a registered repository never reads or writes its own cache and never scans its own knowledge ([ADR-0633](../../../../decisions/execution/providers/hooks/0633-record-a-linked-worktree-in-its-registered-repository.md)):

- Its prompts use the registered repository's cached identity when the project and policy match, whatever revision the cache records. The resident keeps that cache warm after its commits.
- With no identity cached for the repository, `corpus_preparation` fails at once with `knowledge_inspection_failed`, and the prompt degrades instead of scanning until the hook deadline.
- Stop's detached prefetch and the ADE workspace warm-up hash the worktree's files. They compute the repository's identity only when none is cached.

Unsafe paths, oversized bytes, and persistence failures leave the freshly scanned identity available. A racing producer can lose its disposable temporary file without changing the computed result. These safeguards govern this knowledge-snapshot cache, not every repository snapshot or search cache.

Revision disagreement prevents publication, but the function still returns the scan's snapshot ID. This guard does not independently prove that every returned scan came from an unchanged repository. The cache stores coordinates, not source bodies, and is not a lifecycle-current receipt.

These safeguards reflect the supplied runtime implementation specification. This documentation reconciliation does not independently verify implementation bytes, successful cache publication, installed latency, or background lifecycle completion.
