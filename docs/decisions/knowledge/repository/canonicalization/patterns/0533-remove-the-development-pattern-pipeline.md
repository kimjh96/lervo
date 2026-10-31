# ADR-0533: Remove the development-pattern pipeline

Status: `accepted`
Decision date: 2026-10-25

## Context

The owner approved removing the unused development-pattern implementation. The reviewer inspected event stores across all Lervo repositories on both hosts on 2026-10-25:

- `lervo` recorded four `development.pattern.observed`, eight `development.pattern.transitioned`, two `development.pattern.evaluation.registered`, and one `development.pattern.effect.observed` event, all between 2026-08-25 and 2026-09-03.
- `flemo` recorded two observations and six transitions on 2026-08-27.
- `axli`, `digimon`, `plen`, and `shiflo` recorded none.
- One pattern was promoted: `pattern_285ccedd87540741b450a9f5`, targeting a repository instruction on 2026-09-03. The reviewer found its record in the local development-pattern projection.
- The reviewer reported zero terminal outcomes with `portable_skill_candidate`. Declarations overall nearly stopped after 2026-09-22.

ADR-0451 removes the declaration requirement while a healthy background knowledge owner is running. The workflow-to-skill gate requires two independent source groups, distinct passed verification events and runs, and exact source, skill, resource, input, output, tool, and permission contracts. The reviewer found no successful use of that gate. Stored `terminal.turn.declared` events omit the outcome body, so those events alone cannot establish whether that kind was ever submitted. The absence of recorded portable-skill promotion and the manual intake design are separate evidence.

Code has two additional manual entrypoints: `knowledge pattern propose` and the `role candidate` aliases. Terminal declaration is therefore not the only entrypoint, but no entrypoint observes repeated work in the background. The pipeline depends on an agent explicitly preparing a proposal.

The goal remains: Lervo learns reusable practice from verified work. [ADR-0458](../../../../execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md) stays in force: a single verified observation creates a candidate, and promotion needs exact review or used-in-practice evidence. A future design observes verified work in the background, following the instruction-capture approach in ADR-0467. An independent reviewer agent handles review instead of the owner.

## Decision

Remove pattern proposal, review, lifecycle projection, promotion, supersession, rollback, portable-skill package derivation, and agent-profile candidacy. Remove `knowledge pattern propose|status|review|promote|rollback`, `knowledge pattern effect collect|register|observe`, and every `role candidate` alias. Ordinary role list, show, and validate remain.

Remove pattern-only CLI effect routing, collection wrappers, storage, service injection, and controller comparison policy. Keep the observation ports, local verification metrics, storage adapter, and conformance package. Their contracts inspect verification-completion evidence independently of pattern promotion. They no longer have a pattern CLI host.

Keep ordinary skill loading, authorization, migration, and execution. Existing authored packages may still carry the historical `lervo.development-pattern` publisher. Retain its exact project-authorization and migration guards so removal cannot grant those bytes new authority. Preserve all portable skills and the promoted repository instruction.

### Historical reads and local state

Keep all four `development.pattern.*` event names, payload schemas, catalog entries, redaction rules, and trace labels as historical reader contracts. Stored-event validation and privacy filtering still apply. No active producer remains.

New declarations reject `portable_skill_candidate`. The existing parser serves new input, not stored declaration reads. Before this removal, declaration writing stripped `canonicalizationOutcome` before appending `terminal.turn.declared`; proposal bodies lived separately in local CAS. The stored declaration schema never included this outcome kind and remains unchanged. There is no persisted declaration-payload read path on which to split proposal parsing from writing. Old submitted JSON containing the kind is no longer accepted as a new declaration. Existing events and CAS bytes remain intact.

Leave local development-pattern and improvement-effect state and artifacts untouched. Add no state deletion or destructive migration. Layout migration stops stripping historical development-pattern route blocks and continues maintaining the shared instruction registry bootstrap.

Instruction capture and the three ordinary canonicalization outcomes retain their contracts. This change adds no event, state, or failure code.

### Future learning

Track one [background reusable-practice learning item](../../../../../roadmap/knowledge/background-practice-learning.md). Its acceptance requires single-observation candidates observed in the background, independent agent review with ADR-0458 promotion rules, output as repository instructions or portable skills, and no turn declaration. It grants no background write authority and must not interrupt development.

## Consequences

The removed CLI commands are a breaking change and require major release intent. Historical event stores remain readable. Previously promoted content and ordinary skill packages remain usable through their existing authority checks.

The source no longer advertises an implemented learning pipeline. Background learning needs a separate reviewed design and implementation. Repetition and favorable proxy metrics still establish neither correctness nor causal improvement.

## Verification

Focused regression tests cover rejection of removed commands and new portable-skill declarations, retained event and declaration reads, and preservation of historical route blocks during layout migration. Existing instruction-capture, canonicalization, skill-authorization, migration, privacy, and observation tests remain. The owner prohibited test execution for this task; these tests were not run.

Static type, quality, documentation, lifecycle, and release-completion results are recorded in the workstream and task report. Build runs at most once after source changes. Release manifests and the SBOM remain for the reviewer to regenerate in an environment with network access.
