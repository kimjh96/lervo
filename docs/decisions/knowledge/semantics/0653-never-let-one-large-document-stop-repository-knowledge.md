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
   - **Split points.** The split cuts at the shallowest heading level that keeps parts within the bound, then at deeper headings, and finally between top-level blocks, so never inside fenced code or a list. A pipe table that is too large is split between rows, and each continuation repeats the table's header and delimiter rows.
   - **What the document keeps.** The document keeps its preamble and a Lervo-managed block (`document-parts`) that links the parts in order.
   - **Where the parts go.** Each part is `<directory>/<document stem>/<NN>-<slug>.md`. A document with more than 32 parts groups them into numbered directories of 32.
   - **Links.** Relative links inside a part are rebased to the part's directory. Anchors inside the document are not rewritten.
2. **Check the split deterministically.** Instead of a provider review, the check is deterministic:
   - the preamble and every part's original byte range reassemble the document exactly, and repeated header rows are the only additions;
   - planning again from the current bytes yields the same index and parts.

   A provider review cannot take documents over 1 MiB. The split is its own reversible `Lervo Knowledge` commit (ADR-0561), and the notice names the deterministic byte verifier as the cross-check.

3. **Bring unread documents into knowledge.** A document the scanner left out for its size is split the same way. It had no knowledge identity, so its parts carry no lineage. A registered document's parts carry `document_split` lineage, as ADR-0183's split does.
4. **Report what cannot be split.** A single block still over the bound, a document over 16 MiB, and a document that is not UTF-8 are named in the plan and in `lervo migrate knowledge` output, as `document_unsplittable` or `document_too_large`. Until a document over 256 KiB is split, normalization output names it and attention carries the `document_too_large_to_normalize` advisory. They never block the other documents.
5. **Normalize in batches.** When pending documents exceed one run's source-byte or provider-call ceiling, each run normalizes the next batch in path order, recorded as an explicit selection. A single document over the ceiling still blocks, before any provider call.
6. **Review a move by its changes.** A document that a plan moves byte for byte is shown to the reviewer by hash and destination. A move that rewrites references is shown as the lines it rewrites; Lervo checked that every other line is identical. A rewrite that changes the line count, or more than a quarter of the lines, is still shown whole.

## Consequences

- A repository with large documents gains parts under new directories, with links from the original paths. Links into a moved section's anchor from elsewhere need the part's path.
- The 512 KiB bound on one canonical assessment source, and the repository-wide capture bounds of 20,000 files and 256 MiB, still stop their stage. With documents split first, they are reached only by non-document sources or by repositories that large.
- `axli-lab` reproduction on a clone of `main` (`203763cae`):
  - The split divides its eight documents over 1 MiB into 76 parts of at most 262,105 bytes, and knowledge lint stays valid.
  - Normalization preflight is `ready` with a first batch of 44 documents and 1,044,414 bytes.
