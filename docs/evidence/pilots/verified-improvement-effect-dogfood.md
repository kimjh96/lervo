# Verified improvement-effect dogfood

Status: `observed`

Date: 2026-09-03

## Reviewed pattern and promotion

The first candidate, `pattern_64f4b7ae9e2c549b989623ce`, received baseline protocol
`ieprotocol_d17d17621f37e3ddcfe8a788`, but its promotion plan correctly blocked with
`source_snapshot_changed` after intervening repository changes. It was not promoted.

The same meaning was proposed again from the current sources as
`pattern_285ccedd87540741b450a9f5`. Review artifact
`sha256:1aec810d54aab6f15662d7193092bbff6cc222ffcb1937ec56c052c5f6ede569`
accepted candidate
`sha256:de1ddc67ceeb35c59918afa7426059b4afa3c590e1753a1947c87df41b927c97`.
Baseline protocol `ieprotocol_93bd248183af5a0f387480ca` was registered before promotion
through event `evt_6dabfc844e704f61ad7432c8bf7ec694`. Promotion event
`evt_960eeec35cd448d1a773ef91d1898024` then created
`docs/instructions/evidence-bound-improvement-observations.md` with content hash
`sha256:b6e747387a6f860e44f497e88e5ab7c023cc4fc79cda2715bc3344b0e7ce2d12`.

## Exact observations

| Phase     | Inclusive window                                     | Verification success | Repeated failure |
| --------- | ---------------------------------------------------- | -------------------: | ---------------: |
| Baseline  | 2026-09-03T03:13:03.295Z to 2026-09-03T04:59:25.024Z |                10/10 |             0/10 |
| Treatment | 2026-09-03T05:08:57.490Z to 2026-09-03T05:22:51.209Z |                10/10 |             0/10 |

The local adapter reverified both immutable event windows. Comparison
`iecomparison_77ff32239d31c727d87cd614` was recorded through event
`evt_f51ce0ff4617453a9d803229c5d34cde`. Both metric deltas were zero basis points, so
the aggregate result is `no_material_difference`. Attribution remains `unestablished`,
and rollback is `not_authorized`.

## Verification boundary observed during treatment

The configured `repository.default` suite measured one TypeScript command. During treatment,
managed run `run_a14f29e5086d4898a02d09ad1b5f862c` passed that suite, but an immediate focused
Vitest run found that its JavaScript test used `lstat` without importing it. The import was added,
and the focused suite, quality checks, type checking, and release-completion check then passed
before commit `761c945`.

This does not invalidate the registered rate: the event truthfully reports the configured suite's
result. It does show that `verification_success` is a proxy for that exact suite, not proof of task
correctness. Expanding JavaScript verification is therefore a separate
foundation improvement candidate. It must version the suite and evaluation design rather than
retroactively changing either observation window.

After this pilot closed, ADR-0350 preserved `repository.default` for historical revalidation and
added `repository.default.v2` with repository ESLint before type checking. The measured lint
command rejects the observed unresolved JavaScript identifier and completed in 0.56 seconds with
the existing local cache. Future automatic deliberation prefers the highest versioned default;
explicit managed runs must name version 2. This does not alter the baseline, treatment, or
comparison above. Runtime-focused tests remain a separate and stronger verification layer.

ADR-0351 then added `repository.default.v3`, which retains version 2 and follows its static checks
with bounded Vitest related-test execution. Version 3 is a prospective verification contract; it
does not reinterpret any pilot event or establish causality.

## References

- [Evidence-bound improvement observations](../../instructions/evidence-bound-improvement-observations.md)
- [Verified improvement effects](../../specifications/execution/verified-improvement-effects.md)
- [Repository development-pattern lifecycle](../../specs/repository-development-pattern-lifecycle.md)
- [Governed loop and assignment graph](../../roadmap/governed-loop-assignment-graph.md)
- [ADR-0350](../../decisions/execution/verification/0350-version-default-repository-static-verification.md)
- [ADR-0351](../../decisions/execution/verification/0351-add-bounded-related-runtime-tests.md)
