# Relation Web

[ADR-0562](../../decisions/foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md) gives each checkout one relation web. This page defines version 1. The link web, governing index, staleness, freshness, and reference lint still compute their own relations until a later slice moves them onto the web.

## State

`.lervo/state/relation-web.sqlite` is private, rebuildable state with mode 0600. Markdown, repository files, workspace manifests, the CLI usage text, and source lineage records stay canonical. Deleting the file loses nothing.

It stores documents (path, content hash, extractor version, observed revision, ADR number, header status, scan role, historical flag, truncation), edges with evidence, tracked files, workspace packages, the CLI command catalog, and lineage facts. It stores no document text.

A refresh reads every tracked or untracked, not ignored, Markdown file of at most 1 MiB outside `.lervo/`. A document whose content hash and extractor version match the stored extraction keeps it, so unchanged documents are extracted once. The write replaces the stored web in one transaction.

If the build or the write fails, the previous web stays in place and the refresh reports `relation_web_stale` with the failure message. A store that cannot be opened or has another schema version is deleted and created again.

## Nodes and edges

Node identities are `path:<path>` (a file, directory, or document), `adr:<NNNN>`, `package:<name>`, and `command:<words>`. An ADR number resolves to the one document whose `# ADR-NNNN` title or `NNNN-` decision file name carries it. A number that several documents carry resolves to none of them.

Every edge has evidence: extractor version, source document, line, strength, and observed revision.

| Edge                                                            | Source                                                                                                                                                                    | Strength                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `links_to`                                                      | Markdown links and reference definitions                                                                                                                                  | `strong`                          |
| `names_path`                                                    | Inline code paths, path symbols, and fence paths ([ADR-0464](../../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md) reference rules) | `strong` or `weak`                |
| `names_package`                                                 | `@lervo/<name>` anywhere                                                                                                                                                  | `strong`                          |
| `names_command`                                                 | `lervo` and up to six command words; resolved to the longest catalog command or a command group                                                                           | `strong` in code, `weak` in prose |
| `names_adr`                                                     | A bare `ADR-NNNN` outside link syntax and outside header declarations                                                                                                     | `weak`                            |
| `amends`, `supersedes`, `supersedes_part`, `part_of`, `related` | The ADR header grammar                                                                                                                                                    | `header`                          |
| `moved_to`, `merged_into`, `retired`                            | Document move lineage and its closures                                                                                                                                    | `lineage`                         |

The ADR header is every line before the first `##` heading, at most 80 lines. Header keys are `Status`, `Supersedes` (targets after `in the named part:` are `supersedes_part`), `Supersedes in part`, `Superseded by`, `Superseded in part by`, `Amends`, `Amended by`, `Part of`, and `Related`, optionally as list items. Targets are Markdown links or bare `ADR-NNNN` numbers. A key line without targets continues through the bulleted list below it. A `Status: superseded by <target>` line declares an incoming `supersedes` edge.

A document has at most 1,024 edges; a document at the bound is marked truncated.

## Suspects

`relationSuspectsFor(web, change)` maps changed and deleted paths to the documents that may no longer match the repository. A directory is removed when no tracked file remains below it. Historical and deleted documents are never suspects.

| Reason               | Meaning                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `path_removed`       | A path or directory the document links to, names, or declares in its header no longer exists                            |
| `moved_target`       | Such a removed path has a lineage destination                                                                           |
| `path_changed`       | A non-Markdown path it names strongly changed, or one changed below a directory it names strongly that is not top-level |
| `package_removed`    | The directory of an `@lervo/` package it names was removed                                                              |
| `command_removed`    | A catalog command, or a command group whose every command was removed, left the catalog                                 |
| `target_superseded`  | A document it names is superseded in full by a header declaration that is new in a changed document                     |
| `target_amended`     | A document it names is amended by such a new declaration                                                                |
| `superseded_in_part` | A new declaration supersedes a named part of this document                                                              |
| `amended`            | A new declaration in another changed document amends this document                                                      |

A document superseded in full by a new declaration is listed under `superseded`, because it becomes historical.

## Document lifecycle

Every document in the web has one lifecycle state ([ADR-0562](../../decisions/foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md) section 2):

| State                  | Meaning                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `current`              | Assessed at `assessedRevision`, and nothing it names changed since                               |
| `suspect`              | At least one reason is open; `assessedRevision` stays at the last revision it was known to match |
| `refreshed`            | A `verified_no_change` freshness assessment of its current bytes still matches HEAD              |
| `superseded`           | Its header `Status:` is `superseded`                                                             |
| `partially_superseded` | Another document supersedes a named part; the rest stays current                                 |
| `archived`             | Another historical marker: archive scope, front matter, or banner                                |
| `retired`              | A reviewed lineage record retired its path                                                       |

A suspect's reasons are the suspect reasons above plus `cadence_due` (the sweep has not reached it) and `superseded_undeclared` (another document supersedes it in full, but its own header does not say so). Each reason is settled in one of four ways:

- `deterministic`, with no edit and no provider call:
  - the changed lines of a changed path contain no code name the document mentions;
  - an amendment of a target it names;
  - a lineage move of a removed target;
  - a supersession it already names;
  - a removal that every line naming the removed part already records.
- `mechanical`: a missing reverse header line (`Amended by`, `Superseded in part by`, or a superseded status). This is a deterministic edit, never a provider call.
- `provider`: the remainder, which goes to the freshness path of ADR-0463 and ADR-0561.
- `cadence`: the document is waiting for the sweep.

The sweep reaches at least 16 documents per UTC day, and enough to reach every document within 14 days. Documents that name code go first, then canonical documents, then by path. A never-assessed document is evaluated from its own last commit. A recorded one is evaluated from its assessed revision, with one diff per baseline group. A document whose provider reason is open keeps its baseline. Its reasons are reused until a later change reaches it.

### Record and failure

`.lervo/state/knowledge/document-lifecycle.json` (mode 0600) holds the only lifecycle state the web cannot rebuild:

- per document: its content hash, assessed revision, evaluation time, and up to 32 open provider reasons;
- the day's sweep count;
- the fence;
- the last summary.

It holds at most 4,096 documents, the first by path. A document past that bound is never swept, so it stays unassessed instead of being counted as swept. A write that would exceed 4 MiB drops the cached reasons first, because without them a document is evaluated again from its own baseline. A record still too large is refused, so a record never reads back as empty. A missing or malformed record reads as empty, and each document then falls back to its own last commit; an invalid entry is dropped alone.

A baseline that Git cannot diff, such as a rewritten commit, makes the document `suspect` with the evaluation unknown. Its entry is dropped, so the sweep evaluates it again from its last commit.

### When it runs (shadow)

The lifecycle runs in shadow, only in the two callers that record the staleness reading: the knowledge currency pass and the freshness observation. Read-only lint never evaluates it.

**Fence.** The fence is the recorded staleness coordinate: HEAD, the scan's document hashes, the UTC day, coverage, and assessments. A recording call whose coordinate equals the record's fence does nothing, so an unchanged repository builds the web at most once per day.

**Per-call budget.** A call that runs starts at most 32 diff groups, and none after 20 seconds. Each Git call is bounded at 20 seconds.

- A document whose group does not fit is deferred. A swept one is not counted as swept, and a recorded one keeps its assessment.
- The fence stays open until a call completes without deferring, so the next recording call continues.
- A failure leaves the shadow reading missing and changes nothing else.

**Writes.** The web is written with its `lifecycle` table, then the record with its fence and summary.

The staleness findings that lint, freshness and health act on still come from the ADR-0023 connected-path evaluator. Repository health reads the recorded summary and never evaluates the lifecycle. When the summary was recorded at the current HEAD, health adds `freshness.lifecycle` to its projection: counts per state, suspects by what settles them, and cadence coverage. Its text line is unchanged.

Switching the findings to the lifecycle is roadmap item 8, after the shadow counts are measured on installed hosts. That switch also replaces the ADR-0023 review interval (`reviewIntervalDays`, ADR-0464), so it needs its own decision. No new event is recorded, and the lifecycle changes no repository bytes.

## Inspection

`lervo knowledge web stats [--json]` refreshes the web and prints its counts by node kind, edge kind, and strength. `lervo knowledge web suspects --since <revision> [--json]` refreshes the web and lists the suspects of the change from the revision to the worktree. Renames count as a deletion and an addition, untracked files count as added, and a deleted workspace manifest keeps its package name. It does not compare command removals, because the catalog at the revision is unknown. Both commands change no repository bytes and exit with status 1 when the web is stale.

## Acceptance replay

`packages/repository-knowledge/test/relation-web-replay.test.ts` replays the ADR-0560 merge on main (pull request 286, both sides of `a9c25602`). The fixture lists 87 documents that still named a removed package, command, or path, found by an oracle independent of the web and reviewed line by line. The web marks all 87 as suspect with a removal reason. In CI, where the history is complete, a missing replay revision fails the test instead of skipping it. At least 90 percent of its suspects are confirmed by the oracle or were edited by the removal itself; the rest name a fully superseded decision.
