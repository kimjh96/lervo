# ADR-0350: Version default repository static verification

- Status: `accepted`
- Decision date: 2026-09-03

## Context

The Lervo repository's tracked `repository.default` suite runs only `pnpm typecheck`. During the
first verified improvement-effect dogfood treatment, managed run
`run_a14f29e5086d4898a02d09ad1b5f862c` passed that suite even though its changed JavaScript test
referenced `lstat` without importing it. An immediate focused Vitest run exposed the defect.

The verification event truthfully described the configured command, but the default static floor
left a known gap. Editing `repository.default` in place is unsafe: canonical historical results
bind its prior hash, and repository knowledge revalidates those results against the tracked suite.
An in-place edit therefore makes the complete evidence source unverifiable. Making the
orchestrator inspect JavaScript would instead mix repository policy with provider-neutral
execution, while running every test after each managed change would add a much larger and less
predictable default cost.

## Decision

Preserve `.lervo/verifications/repository.default.yaml` byte-for-byte as the historical version and
add `.lervo/verifications/repository.default.v2.yaml` as its successor. Version 2 runs `pnpm lint`
as `repository-lint` before the retained `pnpm typecheck` command and stops on failure. ESLint owns
repository JavaScript and TypeScript code-quality analysis, and its `no-undef` rule rejects the
observed missing import; TypeScript remains the authoritative type analysis.

Automatic deliberation selects the highest positive decimal `repository.default.vN` suite,
compared without bounded-integer conversion, then falls back to `repository.default`, then to the
sole non-pilot suite. Ambiguity still fails before provider execution. Explicit managed runs remain
exact: callers name `repository.default.v2`; Lervo does not silently rewrite an explicitly supplied
suite ID.

Keep discovery and version selection in a focused CLI module. The verification runner remains
language- and provider-neutral: it loads repository-authored suites, executes exact bounded
commands without a shell, and records suite hashes and artifacts. The lint command has a
300-second timeout and 1 MiB output limit. Its cache remains below ignored `node_modules`, so it
does not change the tracked repository snapshot.

Each versioned ID has one immutable evidence meaning. Do not compare version 2 success rates with
the dogfood windows as though their verification contracts were identical. Passing version 2
proves only that lint and type checking passed for the bound revision. It does not prove focused
tests, runtime behavior, task correctness, provider understanding, or causal improvement.

## Verification

On the current repository, a standalone `pnpm lint` completed successfully in 0.56 seconds with the
existing cache. Feeding ESLint the treatment defect under the same `.mjs` path produced a
`no-undef` error for `lstat` and a nonzero exit. Focused resolver tests cover highest-version,
historical-default, sole-non-pilot, ambiguous, and missing-configuration outcomes. The tracked
version 2 suite loaded and passed both commands as a whole with suite hash
`sha256:8ca744cc3813e73d86f036bcdb47dddbdbb4cfb1353eb14ff99e589d36a3296f`;
lint completed in 589 milliseconds and type checking in 5,153 milliseconds.

## Consequences

Future automatic deliberation gets a broader static floor without invalidating historical
verification evidence or coupling provider-neutral execution to a language. Explicit callers can
adopt version 2 without alias ambiguity. JavaScript unresolved identifiers fail before type
checking, while runtime-focused test selection remains an explicit stronger suite or a future
independently designed changed-file verification concern.

## References

- [ADR-0032](0032-managed-run-project-verification.md)
- [ADR-0176](0176-bounded-verification-result-sources.md)
- [ADR-0200](../providers/0200-natural-language-terminal-turn-finalization.md)
- [Improvement-effect dogfood](../../../evidence/pilots/verified-improvement-effect-dogfood.md)
