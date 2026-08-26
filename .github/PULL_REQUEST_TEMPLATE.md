<!-- Follow writing_en-human. GitHub renders the title separately, so start at H2. -->

## Summary

<!-- State what changed and why. Lead with the user or repository outcome. -->

## Scope and authority

<!-- List what is in scope, intentionally out of scope, and any external writes performed. -->

## Contract and architecture

<!-- Name the touched responsibility and dependency boundary. Note structural splits or a bounded follow-up. -->

## Release impact

<!-- Link the release intent or give the exact exemption. A release PR never grants npm publication authority. -->

## Verification

<!-- List exact commands and results. Do not claim unobserved checks. -->

## Knowledge and documentation

<!-- Identify canonical docs, roadmap criteria, migration, lint, and workstream updates, or explain N/A. -->

## Risk and recovery

<!-- Describe material failure modes, rollback or replay behavior, and any remaining bounded risk. -->

## Checklist

<!--
The PR author must evaluate these items directly. Change an item to [x] only after its
supporting evidence has been observed. Leave an unmet item unchecked and explain the blocker
in the relevant section. For an inapplicable item, check it only after recording an exact
"N/A: <reason>" in the relevant section. Checkboxes are attestations, not substitutes for CI.
-->

- [ ] I read `AGENTS.md` and the relevant linked entrypoints before changing bytes.
- [ ] I reviewed every touched source against `docs/foundation/code-convention.md`.
- [ ] Repository-authored state is bounded; this change adds neither an append-only file nor a one-file-per-operation archive.
- [ ] Lervo-managed, generated, and user-owned bytes retain distinct owners.
- [ ] Affected documentation and roadmap completion criteria are current.
- [ ] Relevant tests, `pnpm quality:check`, and required Lervo migration/lint checks pass.
- [ ] No secret, mutable credential, or unsupported authority is included.

<!-- Preserve every section. Use "N/A: <reason>" instead of deleting a section or leaving it blank. -->
