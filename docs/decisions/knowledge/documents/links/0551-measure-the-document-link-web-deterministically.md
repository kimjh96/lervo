# ADR-0551: Measure the document link web deterministically

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0535](../../../execution/applications/0535-project-core-health-with-actor-owned-attention.md) (broken-links measure)
Related: [ADR-0464](../0464-report-document-drift-and-historical-documents.md) (historical documents and link findings)

## Context

The core outcomes ask for knowledge linked tightly enough that its parts verify and complete each other, and for migrations that break no link. The health projection's broken-links measure was always `unknown`: the lifecycle cache it read records lint validity, not link counts. Lint finds broken links only when it runs, and nothing measured how the documents connect.

The first measurement on 2026-11-01 found these gaps in the Mac checkout of `lervo`, across 1,730 current documents and 4,605 links:

- 17 broken links;
- 104 `Amends:` header links whose target does not link back;
- 152 canonical documents that no other document links to.

## Decision

### One provider-free link web

`buildDocumentLinkWeb` reads the current Markdown and the tracked path set. It reuses the reference extractor and the historical-document marker that lint uses, in a link-only mode so code references never spend the per-document bound. A document that still reaches the bound makes the measure `partial` with `link_extraction_bounded`. It reports:

- **broken links:** Markdown links whose resolved target is not a tracked file or directory;
- **missing back-links:** an `Amends:` header link, resolved like every other link, whose target exists, is current, and has no link to the amending document;
- **orphans:** canonical documents (by scan priority) inside a directory, other than `README` and `index` files, with no inbound link from another document.

Historical documents are frozen records. They are not checked, need no inbound links, and their links do not count. Markdown under `.lervo/` is a generated projection and is left out.

### Built in the background, reused until Markdown changes

The health prefetch rebuilds the web only when its input digest changes: the content hash of every tracked or untracked-but-not-ignored Markdown file, plus the full path set that link targets resolve against. An unchanged digest is re-observed after an hour, so an idle repository's measure does not expire. It writes `.lervo/state/link-web.json` with counts and at most 16 examples of each finding. On the Mac checkout of `lervo` a rebuild takes about 0.2 seconds.

### Health reports it

The broken-links measure reads that summary. Broken links or missing back-links are a gap; the orphan count is reported with them, because an orphan is unconnected knowledge, not an error. The summary expires after one day. The line names the freshness cycle, which already repairs broken links through reviewed candidates.

## Limits

Repairing missing back-links and connecting orphans is not decided here. Both edit user-owned documents, so they must go through the reviewed freshness path rather than a direct write.

## State, events, privacy, and failure meaning

- `.lervo/state/link-web.json`: `schemaVersion: 1`, `observedAt`, `inputDigest`, document, link, and finding counts, and bounded examples with repository paths and line numbers. It is private, mode `0600`, and deletable.
- The broken-links value gains optional `missingBacklinkCount` and `orphanCount`.
- No event is added. A failed rebuild leaves the measure `unknown` with `link_web_unavailable`.

## Verification

- `apps/cli/test/link-web.test.ts` covers broken links, orphans, missing back-links including encoded links, the extraction bound, historical and generated exclusion, rebuilds on content-only and target-only changes, and re-observation.
- `apps/cli/test/repository-health-projection.test.ts` covers the gap rule, the wording, and expiry.
