# Installed continuation protocol and evidence

Observed: 2026-09-05

## Conclusion

The packed `@lervo/cli` 0.11.4 artifact continued one bounded repository workstream from Codex into a fresh Claude run without resuming either provider conversation. Codex completed and verified the first target revision. Lervo advanced the same workstream identity, rejected a tampered current projection before creating Claude, restored the exact recorded revision, and completed a second verified change through a new Claude SDK session.

Passing witnesses: `run_b8a98e5e6df54cd2ae4cc7ced990b4a3`, then `run_16179d586e5b4739b162643344f44747`. Each regression creates a fresh temporary consumer, workstream, and pair of runs; these IDs identify one observation, not stable fixture coordinates.

## Installed protocol

1. Pack the production CLI tarball and install it into an empty consumer without workspace-private runtime packages.
2. Initialize a separate local repository, activate event schema v2, declare one verification suite, and start a revision-1 workstream through the installed CLI's plan/apply boundary.
3. Run the production Codex adapter with a deterministic app-server fixture. Observe the exact workstream bytes delivered as governance context, authorize only `src/result.ts`, pass repository verification and writing evaluation, and retain the result artifact hash.
4. Advance the same workstream to revision 2 with the Codex result digest and Claude continuation action. Change only the current projection bytes and confirm `lervo run --provider claude` fails before the Claude executable starts.
5. Restore the exact recorded projection. Replace only the temporary consumer's already-verified Claude native executable with a deterministic stream-JSON fixture. Run the production Claude SDK adapter, managed-write hooks, result normalization, writing evaluator, and stop path.
6. Compare both installed run outcomes, exact delivered workstream documents, target bytes, and full per-run traces before deleting the temporary consumer.

## Observed evidence

| Boundary | Observation |
| --- | --- |
| Workstream identity | Revisions 1 and 2 retained one generated workstream ID; their document hashes differed. |
| Fresh coordinates | Codex and Claude returned distinct Lervo run IDs, Lervo session IDs, provider names, and provider-session IDs. Neither adapter received a resume coordinate. |
| Exact loading | Each run's `document.loaded` content hash matched the exact workstream bytes observed outside its provider fixture. |
| Controlled injection | Each run's `context.injected` included its exact workstream document ID. The Codex app-server and Claude SDK fixtures separately observed those bytes. |
| Stale-state safety | A projection whose notes differed from the recorded snapshot was rejected before the Claude fixture created a prompt or managed write. |
| Managed effects | Both providers changed only `src/result.ts` through production managed-write bridges. The Claude fixture exercised SDK `PreToolUse` and `PostToolUse` callbacks. |
| Completion | Both repository verification suites passed. Each `run.completed.resultDigest` equaled its stored result artifact hash. |

## Claim boundary

The deterministic fixtures prove the packed installation boundary, verified workstream recovery, exact revision-specific context loading and injection, stale-projection rejection, provider replacement, managed-write enforcement, writing evaluation, repository verification, and completion evidence.

They do not prove native Codex or Claude conversation resume, transfer of provider memory, live-model quality, provider service availability, model attention, understanding, semantic reliance, device transport quality, or Hub availability. Continuation comes from canonical repository and event evidence; both provider sessions are disposable.

The fixture replaces the Claude executable only after the release check validates the installed platform-native package, version, package closure, executable bit, and real `--version` response. Fixture code is outside the published `@lervo/cli` file list.

## Regression

Commands:

- `pnpm exec vitest run apps/cli/test/managed-run.test.ts`
- `pnpm smoke:packed-cli`

Resources:

- `apps/cli/test/managed-run.test.ts`
- `scripts/distribution/lib/installed-cross-provider-continuation.mjs`
- `scripts/distribution/fixtures/installed-capability-codex.mjs`
- `scripts/distribution/fixtures/installed-continuation-claude.mjs`
