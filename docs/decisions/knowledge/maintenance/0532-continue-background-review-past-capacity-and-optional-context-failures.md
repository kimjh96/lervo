# ADR-0532: Continue background review past capacity and optional context failures

Status: `accepted`
Decision date: 2026-10-25
Amends: [ADR-0530](0530-keep-background-knowledge-moving-past-divergent-targets.md), [ADR-0436](../repository/canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md), and [ADR-0486](../semantics/0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md)
Amended by: [ADR-0546](../repository/source-intake/0546-capture-in-repository-links-without-a-reviewed-declaration.md) (capture also derives undeclared in-repository link descriptors) and the ADR-0547 amendment recorded in [ADR-0620](../repository/0620-bounded-role-based-document-layout.md) (only overflow a write creates or grows blocks it).

## Context

The owner reports two WSL repositories stopped since 2026-10-18. In axli, an approved batch adds two documents to `docs/specs`, which already contains 32 files. The projected layout check rejects it with `document_directory_file_capacity_exceeded`. Canonical assessment receives delegated roots but no layout routes, roles, capacity policy, or current counts. It therefore cannot account for a full destination directory.

The 24-document `maxLeafDocuments` limit governs grouped decisions. Ordinary document writes use `documentPolicy.capacity`, whose default direct-file bound is 32, with repository overrides. At that default, 32 files fill a directory and two new files exceed it. The reported host policy is not available here, so its effective limit is not inferred from the decision-leaf bound.

Source capture excludes `.lervo/generated/`, but changed-path observation does not. Baseline discovery unions those paths with historical, normalization, and candidate obligations without applying the ownership exclusion. This explains how untracked, nonignored generated files enter `assessmentPaths` even though they are absent from captured semantic sources. They inflate obligation metadata; the paths alone do not prove that their bytes reached a provider.

In flemo, every context document has the same fatal read policy. A 172,973-byte changelog exceeds the reader's 128 KiB limit. A selected README alias also fails because every path component must be a real file or directory. A portable-skill directory alias can fail if a selection traverses it, but its presence does not prove selection. The original private failure records neither the selected path nor the reader's closed reason.

## Decision

### Supply layout guidance and park blocked batches

Canonical assessment receives the tracked decision root and routes, document roles, capacity policy with overrides, and observed repository and directory counts. The prompt directs new drafts to a compatible routed child folder within delegated roots. Guidance never expands write authority. The independent reviewer receives the same captured guidance and loaded context.

Before creating a writer assignment, integration evaluates the complete approved batch through the existing repository layout evaluator. If every blocker is a directory-file, directory-child, or repository capacity failure, the entire batch integrates nothing. Candidate sources park as `layout_capacity_exceeded`; without a candidate, all batch sources park. Other decisions retain coverage. The cursor advances to the next workset or normalization, using ADR-0530's parking and ledger marker.

The current code checks the root layout after Git ref integration, in the integrator's root-apply path. An older stopped batch may therefore already have completed its ref effect. After validating that retained integration proof, the runtime verifies every draft's exact bytes on the ref and every unchanged reviewed preimage in the working tree. It then uses ADR-0530's compare-and-swap restoration to return only those draft paths on the delegated ref to `HEAD`'s committed bytes. Other ref paths, the working branch, working tree, and index remain untouched. The batch then parks. This prevents the old ref-only drafts from causing permanent target divergence when layout changes readmit the source. Changed root bytes or a moved ref fail closed. Historical ref integration evidence remains; no root document integration is claimed.

The disposition ledger retains independently approved noncandidate decisions from parked batches across obligations. It excludes their candidate decisions and every unapplied draft. Missing result evidence grants no settlement.

Each capacity parking binds a hash of the observed counts, capacity policy, routes, and roles. Changed source bytes or a changed layout hash readmit the source in a later obligation. Editing unrelated document bodies does not release capacity. Existing stalls receive one evaluation under the new contract.

Routing guidance alone cannot repair an already oversized folder. Under the ADR-0547 amendment recorded in ADR-0620, only overflow a write creates or grows blocks it; existing overflow stays a lint error. Existing unrelated overflow therefore does not by itself block a write elsewhere. Adding documents to a full directory still creates or grows overflow and is blocked. The layout lifecycle retains documents already in canonical trees such as `docs/specs`; it does not automatically subdivide them. It classifies legacy documents and validates grouped decision leaves. This change moves no user documents. Repairing an existing canonical folder requires a separate exact reviewed layout change. Normalization remains subject to the amended write-capacity rule, and existing overflow remains visible to lint.

The complete ADR-0547 text was not supplied for this correction. This paragraph applies only the explicit amendment recorded in ADR-0620; it does not establish additional evaluator mechanics, deployment status, or completed acceptance.

### Exclude owned projections at every assessment entry

The existing generated-prefix predicate now governs complete capture, changed-path observation, the baseline obligation union, and assessment selection, including carried older inputs. It excludes `.lervo/generated/`, `.lervo/state/`, `.lervo/data/`, and `docs/knowledge/`, regardless of Git tracking or ignore state. Historical evidence and candidate debt remain visible; exclusion does not reject a candidate or declare historical work complete.

These are established Lervo-owned locations, not a heuristic for user asset names. No files are deleted, ignored, or relocated. A repository that treats files there as durable user knowledge needs a separately reviewed ownership correction; canonical source bytes must live at ordinary repository paths.

### Degrade optional context reads

Applicable instruction documents remain required. Discovery or loading failure still closes assessment because continuing without repository instructions would weaken its authority boundary.

Linked canonical candidates, query recommendations, focused hits, and source reads used only to enrich queries or discover links are optional. Missing files, read failures including oversized files, unsafe paths including symlinks, changed-during-read failures, and invalid UTF-8 are skipped with a closed reason. Optional reads share a ceiling of 64 attempts per selection. Existing document and aggregate byte ceilings remain. Query failures and readable documents whose expected hash differs still fail closed.

Internal symlinks are skipped by optional context reads too. Under ADR-0436 as amended by ADR-0546, source capture records reviewed link descriptors and derives descriptors for eligible undeclared tracked in-repository links. A declared reference takes precedence for the same path. Derived references require a relative target inside the repository, outside `.git` and `.lervo`, naming an existing file or directory whose target capture passes the complete Git-governed inventory check. Link chains remain unsupported. The 32-reference bound applies to reviewed declarations; derived references remain bounded by the 20,000-path inventory limit. Descriptor capture never follows or reads target bytes through the link, and real targets are inventoried separately. This capture amendment does not authorize review-context readers to follow aliases or establish semantic coverage.

Only successfully loaded documents become context bindings. Canonical batches retain those exact documents, layout guidance, and skip evidence for independent review. Provider observations record skips separately from loaded-context measurements. A skipped path cannot prove coverage or load, injection, or use.

## State, events, privacy, and failure meaning

No public event type or stage state is added.

- `layout_capacity_exceeded` is a parked-source reason, not a public failure code. Required fields are the existing stage, source path, source content hash, attempts, bounded reasons, and `layoutCapacityHash`. The stage is `canonical`. Its private proof has status `layout_capacity_exceeded_parked` and requires the assessment hash, parked source bindings, layout hash, and closed capacity blocker codes. When an earlier ref-only effect was retired, `retiredRefEffect` also requires its ref, before and after commit, and restored paths. These coordinates remain private; the existing Lervo ref commit records restoration without a new public event. `canonicalTargetParked` means no draft in that batch was integrated. Final lifecycle attention uses the existing `knowledge_sources_parked` code; owner-local status may show the parked path and reason.
- `contextSkips` is private selection evidence. Each entry requires repository-relative `path` and `reason`. Reasons are `document_missing`, `document_read_failed`, `unsafe_document_path`, `document_changed_during_read`, and `non_utf8`. The reader uses `document_read_failed` for oversized files as well as other read failures. At most 64 entries are recorded per selection; they contain no document bytes or exception messages.
- A `KnowledgeReviewContextError` carries `documentPath` when a document operation fails. Private stage and assignment failures record that path and the closed document reason when available. Non-document failures keep these fields null. Public events retain only the existing failure code and evidence hash.
- The stage evaluation contract becomes `adr-0532`, allowing an earlier stopped obligation one reevaluation after deployment. The installed runtime also binds its exact evaluator bytes.

## Verification

Focused tests are written for exact ref-only recovery without changing root bytes, capacity parking, preserved coverage, normalization or next-workset advancement, readmission after source or layout changes, routing guidance, generated path exclusion including old inputs, optional oversized and symlinked documents, missing and non-UTF-8 documents, focused query degradation, required instruction failure, exact context bindings, stale readable recommendations, and private failure paths. The owner forbids executing tests in this task.

Installed acceptance remains open: axli and flemo must leave their reported stops on the owner host, reach normalization without another developer turn, and retain precise attention for any remaining parked sources or layout debt. Local static checks cannot establish that recovery.

[ADR-0555](../../execution/applications/0555-keep-operating-signals-visible-and-honest.md) keeps the cause of unclassified stage failures in private evidence and the macOS resident output in a bounded log.
