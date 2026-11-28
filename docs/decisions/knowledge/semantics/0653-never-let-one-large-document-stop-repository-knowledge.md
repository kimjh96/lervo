# ADR-0653: Never let one large document stop repository knowledge

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0358](../documents/0358-bound-document-normalization-worksets-and-preflight.md) (a pending set over one run's ceilings normalizes in batches), [ADR-0481](0481-bind-generated-projections-by-hash-in-lifecycle-plan-review.md) (moved documents are reviewed by hash and rewritten lines)
Related: [ADR-0183](../documents/0183-durable-commonmark-heading-subtree-split.md), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), [document content normalization](../../../specs/document-content-normalization/contract.md), [worksets and preflight](../../../specs/document-content-normalization/worksets-and-preflight.md)

## Context

On 2026-11-28, `lervo migrate knowledge` could not finish on `axli-lab`:

- Its documents include ledgers and catalogues of 0.3 to 4.6 MB, mostly single Markdown tables.
- Applying the layout plan stopped with `knowledge_source_limit_exceeded`. The independent review of an exact plan carries the current bytes of every changed path. A plan that moves a document therefore carries the whole document, and one large moved document pushed the request past its 1 MiB bound.
- A read-only reproduction on a clone of `main` found two more stops:
  - Normalization preflight blocked with `source_bytes_exceeded` (8,350,263 > 1,048,576). The workset selects every pending document, and the 192 pending documents exceed one run's ceiling, so no run could ever start.
  - Normalization skipped four documents of 292 KB to 944 KB with no notice. A single provider pass cannot rewrite them. Seven documents over the 1 MiB `maxFileBytes` were never read; the scanner only counts them as `unsupported`.

In each case, one large document stopped work on every other document, or a document was passed over silently. The owner's rule [rule_71ba2fb394f82b0827829cd2](../../../instructions/generated/rule_71ba2fb394f82b0827829cd2.md) is that Lervo never passes a check it could not finish without saying so.

## Decision

1. **Split before normalizing.** A Markdown document over 256 KiB (`DOCUMENT_SINGLE_PASS_BYTES`), up to 16 MiB (`DOCUMENT_SIZE_SPLIT_MAXIMUM_BYTES`), is split mechanically before normalization. Normalization never receives a document over 256 KiB.
   - **Split points.** The split cuts at the shallowest heading level that keeps parts within the bound, then at deeper headings, and finally between top-level blocks. It never cuts inside fenced code, a list, or a Lervo-managed block. A pipe table that is too large is split between rows, and each continuation repeats the table's header and delimiter rows.
   - **What the document keeps.** The document keeps its preamble and a Lervo-managed block (`document-parts`) that links the parts in order. The preamble is packed with room for that block, so the document itself stays within the bound. Parts leave room for the bytes their rewritten links and copied definitions add.
   - **Where the parts go.** Each part is `<directory>/<document stem>/<NN>-<slug>.md`. A document with more than 32 parts groups them into numbered directories of 32.
   - **Links.** Links follow the text. The CommonMark parser locates every link, image, and definition destination, and only those character ranges are rewritten. A linked image's two destinations, or a badge URL that contains another file's name, are therefore each rewritten in place, exactly once.
     - A relative link in a part is rebased to the part's directory.
     - A link to a heading of a split document points to the file that now holds the heading, with the anchor that heading has there. This applies inside the document and from any other document. Anchors follow GitHub: the visible heading text, without inline HTML, numbered as github-slugger numbers repeats. An explicit `<a name>` or `id` anchor keeps its name.
     - Documents split together are laid out again until no layout changes, so no link names a part path an earlier layout planned.
     - A reference definition that takes effect is copied ahead of each part that uses it. CommonMark uses the first definition of a label, matched case-insensitively with whitespace collapsed, and the copy keeps that true when a part holds a later duplicate or the document ends without a newline.

     A link to a heading that no file holds is listed as a link not kept, whether it sits in the split document or in another document. None is dropped silently.
2. **Check the split deterministically.** Instead of a provider review, the check is deterministic, and it never plans again. For every file the plan writes, it undoes the recorded link rewrites; each rewrite must lie exactly on a destination the parser reads in the restored text. It then drops the copied definitions, the managed block, and the repeated header rows, and what remains must equal the original byte range. The ranges must cover the document in order. A linking document must restore to its current bytes once its recorded link rewrites are undone. Each document is also checked while it is planned. A document whose split fails that check, whose part path is taken, or whose links name a part the final plan does not write is reported as `document_split_failed` with its reason, and the other documents still split.

   A provider review cannot take documents over 1 MiB. The split is its own reversible `Lervo Knowledge` commit (ADR-0561), and the notice names the deterministic byte verifier as the cross-check.

3. **Bring unread documents into knowledge.** A document the scanner left out for its size is split the same way. It had no knowledge identity, so its parts carry no lineage. A registered document's parts carry `document_split` lineage, as ADR-0183's split does.
4. **Report what cannot be split, and never plan it again.** These are named in the plan and on every `lervo migrate knowledge` run as `kept whole`:
   - a document with no cut point that makes it smaller, `document_unsplittable`, which includes a split whose every part would be one oversized block;
   - a split's own index, `document_parts_index`, which is never split again;
   - a document over 16 MiB or not UTF-8, `document_too_large`.

   The output says what to do with them: Lervo leaves them out of normalization; split one by its headings to bring it back, or list it under `normalization.exclude` in `.lervo/knowledge/policy.yaml`. A document that waits for the structural stage to register it is named as `not_yet_registered`. Until a document over 256 KiB is split, normalization output names it and attention carries the `document_too_large_to_normalize` advisory. None of them blocks the other documents. Planning again after an apply is a no-op.

5. **Normalize in batches.** When pending documents exceed one run's source-byte or provider-call ceiling, each run normalizes the next batch in path order, recorded as an explicit selection. A single document over the ceiling still blocks, before any provider call. A candidate whose selected source has since grown past 256 KiB is stale, not invalid.
6. **Review a move by its changes.** A document that a plan moves byte for byte is shown to the reviewer by hash and destination. A move that rewrites references in place is shown as each line's changed span, from its column, with up to 80 unchanged characters around it, however long the line or how many lines change. Lervo checked that every other byte is identical. A rewrite that changes the line count is still shown whole.

## Consequences

- Splitting reads a document in a few whole-document parses, about one second per megabyte on the Mac, about 15 seconds at the 16 MiB maximum.
- A repository with large documents gains parts under new directories, with links from the original paths. Links to a moved heading are rewritten in every included Markdown document that names the split document.
- The 512 KiB bound on one canonical assessment source, and the repository-wide capture bounds of 20,000 files and 256 MiB, still stop their stage. With documents split first, they are reached only by non-document sources or by repositories that large.
- `axli-lab` reproduction on a clone of `main` (`203763cae`):
  - A first split divides its eight documents over 1 MiB into 82 parts of at most 253,947 bytes, with indexes of at most 4,133 bytes. A second split takes the four documents of 292 to 944 KB once the first apply registered them, and a third plan is `current`. The check agrees each time, and knowledge lint stays valid.
  - Normalization preflight is `ready` with a first batch of 44 documents and 1,044,414 bytes.
