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

## Inspection

`lervo knowledge web stats [--json]` refreshes the web and prints its counts by node kind, edge kind, and strength. `lervo knowledge web suspects --since <revision> [--json]` refreshes the web and lists the suspects of the change from the revision to the worktree. Renames count as a deletion and an addition, untracked files count as added, and a deleted workspace manifest keeps its package name. It does not compare command removals, because the catalog at the revision is unknown. Both commands change no repository bytes and exit with status 1 when the web is stale.

## Acceptance replay

`packages/repository-knowledge/test/relation-web-replay.test.ts` replays the ADR-0560 removal against the documents on `origin/main` before it. The fixture lists 85 documents that still named a removed package, command, or path, found by an oracle independent of the web and reviewed line by line. The web marks all 85 as suspect with a removal reason. At least 90 percent of its suspects are confirmed by the oracle or were edited by the removal itself; the rest name a fully superseded decision.
