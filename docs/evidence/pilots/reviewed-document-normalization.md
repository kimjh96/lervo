# Reviewed document normalization acceptance

Status: `passed`  
Date: 2026-08-24

## Scope

This acceptance exercised the complete reviewed content-migration lifecycle against Shiflo and Lervo. Both repositories used the built local CLI and installed Codex; no Hub, npm publication, commit, or push was required.

## Shiflo result

- Candidate `knorm_3b2cef9c5f41960668f2493f` rewrote 38 sources into 39 bounded outputs with exact item approvals.
- Root `HANDOFF.md` became a 47-line continuation entrypoint, with an 83-line grouped history page under `docs/repository/handoffs/`.
- Twenty-one routed instruction documents retained their exact scope frontmatter after the pilot exposed and closed a frontmatter-loss defect.
- Repair candidate `knorm_5281b669b0a75dcf5e0a58eb` replaced obsolete instruction records in the same durable transaction.
- Final normalization replanning returned `current` with zero items; lint passed 44 concepts without issues.
- Workspace typechecking reached the application package and failed only in pre-existing untracked tests lacking Node or Jest types. The documentation migration introduced no reported type error.

## Lervo self-migration

- Candidate `knorm_6ed0bc559b4301ea817b4100` rewrote 211 sources into 211 outputs and created one lifecycle record per source.
- Review covered 606,627 source bytes and 616,496 output bytes, with no blockers, missing Markdown link targets, changed fenced-code counts, or output path changes.
- Exact approvals applied plan `knormplan_6ee4db7dfac5cc4bc7ba648b`; the immediate bridge refresh restored ordinary lint validity.
- Structural refresh contained 235 unchanged operations. A provider replan returned `current` with zero items and operations; lint passed 216 concepts without issues.
- The repository test phase passed 286 files and 1,611 tests. The complete release gate passed architecture, type, build, manifest, SBOM, attestation, CLI/Hub/Node distribution, packed CLI, documentation, language, and brand checks.

## Defects closed

The pilots exposed and closed defects involving missing content rewriting after relocation, oversized handoffs, opaque source-unit transcription errors, instruction-frontmatter loss, stale record accumulation, managed-block false staleness, bridge-transition lint handling, stored-candidate inner-binding gaps, sequential large-repository latency, and an overly literal packed-guide assertion. Shard execution is resumable and limited to three concurrent isolated provider processes.

This report proves the observed commands, outputs, lifecycle records, and verification results. It does not prove that a provider understood every source or that every rewrite is semantically equivalent; exact review remains the semantic boundary.
