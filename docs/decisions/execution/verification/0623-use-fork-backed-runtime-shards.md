# ADR-0623: Use fork-backed runtime verification shards

- Status: `accepted`
- Decision date: 2026-09-28

## Context

Version six split the full Vitest suite into four commands to fit the installed host's per-command timeout. The first local shard passed 218 files and 1,011 tests. The second exposed two independent failures: the new plan test used Node's test API and contained no Vitest suite, and an existing distribution test called `process.umask()`, which Vitest does not support in a thread worker.

The plan test was corrected to Vitest's API. The thread-pool failure remains a verification-policy mismatch, so a complete version-six result cannot be claimed.

## Decision

Preserve the version-six suite and runner as historical definitions. Add `repository.default.v7` with the same four sequential shard positions, risk classes, four-worker bound, command timeouts, and output limits. Its pure plan replaces exactly one inherited `--pool=threads` argument with `--pool=forks` and fails closed if that argument is absent or duplicated. Fork workers allow the existing process-umask distribution test to execute under the full verification floor.

An installed background worker may use version seven only after a new exact reviewed delegation binds its suite ID and hash. A passing result requires lint, type checking, and all four fork-backed Vitest shards. Historical versions and their receipts retain their original meanings.

## Verification and limits

Focused tests confirm fork-pool selection, all shard positions, related-mode retention, and invalid-position rejection. The corrected version-six plan test and the distribution test calling `process.umask()` passed together under fork workers on macOS.

Full local and installed version-seven results remain separate acceptance gates. A host-specific failure or timeout must remain visible as failed verification rather than completed normalization.

## Responsibility review

The version-seven plan owns only the pure pool and shard argument adjustment. Its short runner owns Git observation, bounded diagnostics, and the Vitest child process. The suite YAML owns command order and limits. No provider adapter or knowledge state contract changes.

## References

- [ADR-0622](0622-shard-full-runtime-verification-on-busy-hosts.md)
- [Autonomous background knowledge convergence roadmap](../../../roadmap/knowledge/autonomous-background-convergence.md)
