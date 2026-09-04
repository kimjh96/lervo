# ADR-0351: Add bounded related runtime tests

- Status: `accepted`
- Decision date: 2026-09-03

## Context

ADR-0350 added a versioned static floor after a managed JavaScript test referenced an unimported identifier. ESLint rejects that defect, but static checks do not execute changed behavior. Running all 482 test files after every managed change took 384.66 seconds with one worker on the observed host, making it disproportionate for the default inner loop.

Vitest 3.2.7 already provides repository-aware related-test selection. With `--changed HEAD`, it combines files committed since the supplied revision with staged, modified, and untracked files, then selects affected tests through its dependency graph. Reimplementing that graph in Lervo would duplicate tool policy and create another source of truth.

## Decision

Preserve `repository.default` and `repository.default.v2` as immutable historical evidence definitions. Add `.lervo/verifications/repository.default.v3.yaml`, containing the version 2 lint and type checks followed by this `repository-related-tests` command:

```text
pnpm exec vitest run --changed HEAD --passWithNoTests --pool=threads --maxWorkers=1 --reporter=dot
```

The existing automatic resolver makes version 3 the preferred automatic deliberation suite. Explicit managed execution must continue to name `repository.default.v3`; caller-supplied suite IDs are not rewritten.

Run related tests with one worker, a 900-second timeout, and a 1 MiB output limit. Retain `--passWithNoTests` so documentation-only or graph-unrelated changes do not create a runtime failure. That outcome proves only that Vitest completed selection and found no related test, not that the change has no runtime impact.

Use Vitest's current static dependency graph as the sole selection graph. Imports visible to it and directly changed test files are eligible. Subprocess invocation, runtime filesystem loading, external services, configuration effects, and other relationships absent from the graph remain outside the claim. Their owners still require focused tests or the full release regression suite when warranted by risk.

Each suite version has one evidence meaning. Version 3 results must not be pooled with version 2 or the original dogfood windows unless the distinct suite ID and hash are retained.

## Verification

A clean `--changed HEAD` run completed in 0.37 seconds and selected no tests. A temporary untracked JavaScript test with an unresolved `lstat` reference was selected as the only test file and failed with `ReferenceError` in 1.90 seconds; the fixture was then removed.

The complete tracked version 3 suite passed with hash `sha256:e92455e564879455ca21ea0bde6eeedc4e770cf2e985714ed1f534c563f26ef0`: lint completed in 1,486 milliseconds, type checking in 8,855 milliseconds, and related-test selection in 2,236 milliseconds.

## Consequences

The automatic default adds runtime evidence for changes Vitest can relate without adding repository-specific dependency rules to Lervo core, orchestration, or verification packages. Static and related-runtime checks remain separate commands with separate failure evidence. Full regression testing remains a release-level or explicitly selected stronger boundary, not an implicit version 3 claim.

## References

- [ADR-0024](../providers/0024-provider-neutral-project-verification.md)
- [ADR-0032](0032-managed-run-project-verification.md)
- [ADR-0176](0176-bounded-verification-result-sources.md)
- [ADR-0350](0350-version-default-repository-static-verification.md)
- [Improvement-effect dogfood](../../../evidence/pilots/verified-improvement-effect-dogfood.md)
