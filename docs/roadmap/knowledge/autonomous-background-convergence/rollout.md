# Validation and rollout

Before implementation completion, run structural review, focused lifecycle/provider tests, quality checks, and the task-base-bound release completion check with reviewed CLI/private release intent. Run `lervo migrate knowledge` and `lervo knowledge lint` on the implementation repository. Rehearse readers and writers for every installed consumer before activation.

The 311-document inventory is a bounded starting observation, not a fixed workset or automatic approval. Capture fresh per-project sources and review authority before generation or cleanup. AXLI's product-verification configuration remains a separate prerequisite; this design grants neither tools nor additional usage. On 2026-10-01, the owner stated that Kael is no longer operated; its former provider quota is outside the current rollout.

## Installed verification history

- Lervo normalization apply hit a 900-second full-test timeout in `repository.default.v4` when 353 worktree paths selected the full suite.
- The four-worker, 1,800-second version-five attempt also reached its command limit without a passing apply. [ADR-0622](../../../decisions/execution/verification/0622-shard-full-runtime-verification-on-busy-hosts.md) splits the same selected tests into four bounded Vitest commands.
- A local version-six shard exposed thread-pool incompatibility. [ADR-0623](../../../decisions/execution/verification/0623-use-fork-backed-runtime-shards.md) switched to fork workers.
- A repeated version-seven shard exposed the default per-test timeout under host load. [ADR-0624](../../../decisions/execution/verification/0624-bound-test-deadlines-for-busy-host-shards.md) records an explicit 15-second deadline.
- The installed version-eight canonical candidate failed type checking without isolated workspace dependencies. [ADR-0625](../../../decisions/execution/verification/0625-prepare-isolated-candidate-verification-workspaces.md) adds offline candidate preparation.
- A second installed version-nine attempt passed two full shards before a 30-second native recovery test deadline failed. Its 30-minute stage lease left too little time for the final shard. [ADR-0626](../../../decisions/execution/verification/0626-cover-busy-host-verification-stage-leases.md) bounds both durations.
- The next installed apply exposed two 60-second full-worker test limits. Corrected tests passed a focused WSL run; the longer-lease r159 Node is ready.
- On 2026-10-02, Mac baseline 12441 generated and independently approved eight documents, but apply 12470 rolled back. `repository.default.v9` result `sha256:a368df809778fd63c703043c1ee13817663822b501013519e87ff186a452e062` passed isolated preparation, lint, and typecheck. Shard one failed 13 tests across eight files, including a PR-template wording assertion and loaded-host timeouts. The affected assertions and bounded fixture deadlines were corrected locally; a complete installed rerun remains required.
- A later Mac canonical assessment timed out after a 300-second Codex JSON call with eight sources and twelve context documents. A read-only provider probe passed. Reduced exact-format requests completed in 20 seconds with two sources and three context documents, and in 91 seconds with four sources and six context documents. Assessment now uses the latter bounded input shape and preserves timeout status for transient recovery. Installed completion still requires an observed full stage receipt; the Mac resident worker remains held during this focused repair.

The reviewed version-nine eight-document delegation and call-budget-aware Linux Node are installed. On 2026-10-01, the WSL background worker passed canonical integration and two successive normalization apply verifications; a third batch entered independent review. The r6 Node remained ready after guarded installation. Its transient supervision recovery has focused source coverage but no observed live fault. Completion still requires a stable current knowledge receipt and the remaining installed conversation checks.

## Original reference targets

The source records these exact targets; the links above resolve them from this child document:

- `../../decisions/execution/verification/0622-shard-full-runtime-verification-on-busy-hosts.md`
- `../../decisions/execution/verification/0623-use-fork-backed-runtime-shards.md`
- `../../decisions/execution/verification/0624-bound-test-deadlines-for-busy-host-shards.md`
- `../../decisions/execution/verification/0625-prepare-isolated-candidate-verification-workspaces.md`
- `../../decisions/execution/verification/0626-cover-busy-host-verification-stage-leases.md`
