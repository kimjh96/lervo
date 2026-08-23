# ADR-0116: CLI First-Publication Transition Completion Command

- Status: accepted
- Decision date: 2026-08-21

## Context

ADR-0115 defines a pure transition policy but does not guarantee real file snapshots, one online lifecycle, or immutable output.

## Decision

`release:bootstrap:transition` combines source readers, an online coordinator, the pure core, and an immutable writer. Common inputs are absolute publication-authorization, bootstrap, arming-authorization, workflow, and new-output paths, plus explicit `--online`.

Evidence must be either exactly one execution receipt or the complete resolution/report/decision/reservation-root set. Reject mixed or partial paths before opening files.

Limit JSON evidence to 64 KiB and workflow YAML to 256 KiB regular files. Reject symlinks, empty or oversized files, and parse failures. The execution path rebinds receipt v2 to its contracts. The resolution path revalidates every source and the immutable `publication_unknown` terminal. Treat workflow as a structured snapshot while keeping policy in the core.

Use one online lifecycle to observe exact public npm metadata and dist-tag, npm Trusted Publisher, and GitHub's `npm-release` environment. Feed one later time into report v2. Public release, workflow, npm trust, and GitHub environment must all be ready. Recheck every source byte and storage snapshot before regenerating and validating the receipt.

The writer validates the self-contained receipt and creates only a new absolute output using `wx` semantics, two-space JSON, and a final LF. Exclude paths, actors, reviewers, trust IDs, credentials, and raw responses.

The command only reads npm and GitHub. It does not publish, configure controls, mutate reservation or terminal state, or create runtime events, project state, or telemetry. Success proves only simultaneous observation when the receipt was created.

## Consequences

Both evidence paths share one CLI boundary without losing provenance. Races and incomplete controls produce no output; reconciled unknown state remains unchanged.

Fixtures cover both paths, observers, source races, blocked controls, offline rejection, size bounds, output preservation, invalid argument combinations, and forged hashes. They do not claim publication, 2FA, external mutation, or remote workflow success.

> [ADR-0117](../staging/0117-cli-first-publication-stage-only-workflow-candidate.md) adds a byte-preserving workflow candidate.
