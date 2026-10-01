# Pull-request evidence contract

The [pull-request template](../../.github/PULL_REQUEST_TEMPLATE.md) defines the required reporting structure. Apply `writing_en-human` to the title and body. GitHub renders the title separately: start the body at H2 without duplicating the title as an H1. The [versioned English writing policy](../../packages/core/src/writing-contract.ts) covers pull requests. It leads with purpose or conclusion, uses complete plain-English sentences and concrete verbs, explains internal terms at first use, distinguishes checks run from checks not run, and requires evidence for major claims. Publication requires the policy's deterministic and semantic checks to pass; naming the policy alone does not prove a particular draft passed.

Preserve every template section. Replace guidance with concrete evidence; use `N/A: <reason>` for inapplicable sections rather than deleting them or leaving them blank.

## Required sections

- **Summary:** State what changed and why, leading with the user or repository outcome.
- **Scope and authority:** Identify scope, intentional exclusions, and external writes performed.
- **Contract and architecture:** Name each touched responsibility and dependency boundary. Record structural splits or a bounded follow-up.
- **Release impact:** Link the release intent or state the exact exemption. Tests, documentation, release-management files, and refactors outside the CLI bundle are exempt under [ADR-0221](../decisions/release/packaging/0221-reviewed-cli-release-preparation.md); CLI or bundled-private implementation changes require reviewed intent. A release pull request grants no npm publication authority.
- **Verification:** Record exact commands and observed results. Do not claim unobserved checks.
- **Knowledge and documentation:** Identify canonical documentation, roadmap completion criteria, migration, lint, and workstream updates, or explain why they are inapplicable.
- **Risk and recovery:** Describe material failure modes, rollback or replay behavior, and remaining bounded risks.
- **Checklist:** Evaluate every attestation against observed supporting evidence.

## Checklist evidence

Check an item only after observing its supporting evidence. Leave unmet items unchecked and explain blockers in the relevant section. Before checking an inapplicable item, record an exact `N/A: <reason>` in the relevant section. Checkboxes are attestations and do not replace CI.

The checklist must establish that:

- The author read `AGENTS.md` and relevant linked entrypoints before changing bytes.
- Every touched source was reviewed against the [code convention](code-convention.md).
- Repository-authored state remains bounded, without an append-only file or a one-file-per-operation archive.
- Lervo-managed, generated, and user-owned bytes retain distinct owners.
- Affected documentation and roadmap completion criteria are current.
- Relevant tests, `pnpm quality:check`, and required Lervo migration and lint checks pass.
- The change includes no secret, mutable credential, or unsupported authority.

Follow [repository agent instructions](../../AGENTS.md) for applicable checks and [reviewed CLI release preparation](../decisions/release/packaging/0221-reviewed-cli-release-preparation.md) for release intent and authority boundaries. Recording this contract does not establish that any particular pull request has satisfied it.
