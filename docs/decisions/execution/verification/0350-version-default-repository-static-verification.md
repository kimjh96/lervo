# ADR-0350: Version default repository static verification

- Status: `accepted`
- Decision date: 2026-09-03

## Context

The tracked `repository.default` suite runs only `pnpm typecheck`. During the first verified improvement-effect dogfood treatment, managed run `run_a14f29e5086d4898a02d09ad1b5f862c` passed that suite although changed JavaScript referenced `lstat` without importing it. An immediate focused Vitest run exposed the defect.

The verification event accurately described the configured command, but the default static floor had a known gap. Editing `repository.default` in place would invalidate canonical historical results bound to its previous hash when repository knowledge revalidated them. Having the orchestrator inspect JavaScript would mix repository policy with provider-neutral execution, while running every test after each managed change would impose a much larger, less predictable default cost.

## Decision

Preserve `.lervo/verifications/repository.default.yaml` byte-for-byte as the historical version. Add `.lervo/verifications/repository.default.v2.yaml` as its successor, running `pnpm lint` as `repository-lint` before the retained `pnpm typecheck` command and stopping on failure. ESLint owns JavaScript and TypeScript code-quality analysis; its `no-undef` rule rejects the observed missing import. TypeScript remains authoritative for type analysis.

Automatic deliberation selects the highest positive decimal `repository.default.vN` suite, comparing versions without bounded-integer conversion. It then falls back to `repository.default`, and then to the sole non-pilot suite. Ambiguity fails before provider execution. Explicit managed runs remain exact: callers name `repository.default.v2`, and Lervo does not rewrite an explicitly supplied suite ID.

Keep discovery and version selection in a focused CLI module. The language- and provider-neutral verification runner loads repository-authored suites, executes exact bounded commands without a shell, and records suite hashes and artifacts. The lint command has a 1 MiB output limit. Its timeout is 300 seconds through `repository.default.v8` and 1,800 seconds in `repository.default.v9`. The background knowledge worker runs this suite at background priority in a fresh isolated workspace with no lint cache. There, the uncached, single-threaded, type-aware lint of the whole repository outgrew 300 seconds: on 2026-11-23 two canonical integrations timed out on it, although the same lint takes about two minutes on CI. The timeout bounds a hung process, so it matches the suite's other long commands. Its cache stays below ignored `node_modules` and does not alter the tracked repository snapshot.

Each versioned ID has one immutable evidence meaning. Do not compare version 2 success rates with dogfood windows as if their verification contracts were identical. Passing version 2 proves only that lint and type checking passed for the bound revision; it does not prove focused tests, runtime behavior, task correctness, provider understanding, or causal improvement.

## Verification

On the current repository, standalone `pnpm lint` succeeded in 0.56 seconds with the existing cache. Under the same `.mjs` path, ESLint reported a `no-undef` error for the treatment defect's `lstat` reference and exited nonzero.

Focused resolver tests cover highest-version, historical-default, sole-non-pilot, ambiguous, and missing-configuration outcomes. The tracked version 2 suite loaded and passed both commands with suite hash `sha256:8ca744cc3813e73d86f036bcdb47dddbb4cfb1353eb14ff99e589d36a3296f`; lint completed in 589 milliseconds and type checking in 5,153 milliseconds.

## Consequences

Future automatic deliberation gains a broader static floor without invalidating historical verification evidence or coupling provider-neutral execution to a language. Explicit callers can adopt version 2 without alias ambiguity. JavaScript unresolved identifiers fail before type checking. Runtime-focused test selection remains an explicit stronger suite or a future independently designed changed-file verification concern.

## References

- [ADR-0032](0032-managed-run-project-verification.md)
- [ADR-0176](0176-bounded-verification-result-sources.md)
- [ADR-0200](../providers/0200-natural-language-terminal-turn-finalization.md)
- [Improvement-effect dogfood](../../../evidence/pilots/verified-improvement-effect-dogfood.md)
- [ADR-0351](0351-add-bounded-related-runtime-tests.md)
