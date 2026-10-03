# ADR-0443: Load linked child contracts for canonical review

Status: `accepted`
Decision date: 2026-09-29

## Context

Shiflo's installed screenshot-kit review rejected a generator supplement at event 9385. Canonical context included `reproduction.md` but omitted three linked preview-capture, composition, and invocation contracts. The eight-document recommendation window was full, and lexical recommendations omitted those paths. The reviewer correctly refused to infer their contents from links or an introductory quotation.

## Decision

After loading the instruction hierarchy and at most eight ranked recommendations, load up to four direct Markdown children linked from selected canonical candidates. Each child must resolve inside a directory named for its parent document, such as `reproduction.md` to `reproduction/*.md`. Reject path escapes and nonlocal links. Follow only ordinary paths permitted by current repository knowledge policy; skip sensitive, excluded, and generated-publication paths.

Read every selected child through the repository-confined file boundary and bind its exact content hash to the existing settlement fence. Combined context must not exceed 12 documents or 1 MiB of UTF-8 text. Exceeding the byte bound fails with `review_context_limit_exceeded`; missing or unreadable selected children fail with `review_context_unavailable`.

This supplies routed contract bytes to the generator and independent reviewer without establishing semantic coverage or approving a draft. The reviewer must still verify exact source facts and substantive canonical quotations. The prior rejection remains unresolved until a fresh installed review accepts corrected input.

## Verification and limits

A focused loader regression exercises a full recommendation window, three linked child contracts, an excluded sensitive child, remote and escaping links, and aggregate byte refusal. A real Shiflo context probe must include all three formerly missing paths with exact bytes. Repository quality, documentation, and task-base release checks remain required for this bundled-private change. Shiflo's installed approval, current lifecycle receipt, and Lervo's complete four-shard apply are separate observations.

No new public event, state, provider permission, or document write is introduced. Paths and text remain private review input; public evidence retains bounded hashes and failure codes.

## 2026-10-01 linked instruction amendment

Lervo's installed commit-convention workflow review rejected a draft because `AGENTS.md` linked `docs/foundation/commit-convention.md`, but bounded ranked context omitted it. The link alone could not prove whether the existing convention covered the workflow.

Within the same four additional-document and 1-MiB bounds, include direct local `docs/*.md` links from loaded instruction documents after linked child contracts. Apply the same repository policy, confined read, and exact hash binding. Do not follow remote links or paths outside `docs/`.

This supplies assessment and independent-review evidence without accepting a draft or claiming baseline currency. A focused test binds the linked instruction's exact bytes; installed review must still pass independently.

## 2026-10-01 source-specific authority amendment

An installed Lervo review received the PR-template contract but omitted its linked release decision and versioned writing policy because unrelated roadmap children consumed the additional-document limit. The independent reviewer rejected an otherwise substantive contract quotation because it could not verify those authorities.

After loading the eight ranked documents, rank selected canonical candidates by overlap between their repository path terms and exact source paths. Follow direct local Markdown links from matching candidates before generic child and instruction links. An explicitly linked ordinary Markdown or TypeScript repository source may fill one of the same four additional slots; there is no separate allowance or unbounded traversal. Reject escaping and remote links. Retain included-source classification, publication-root exclusion, confined reads, the per-document 128-KiB limit, aggregate 1-MiB limit, and exact content hashes. Loaded policy source remains review context, not a new authority or proof of model use.

A focused full-window fixture must show that a PR-template contract's linked writing policy and release decision arrive before an unrelated roadmap child. The installed reviewer must still accept exact quotations for the PR template and older supervision-result candidate separately. A source test or context probe settles neither historical obligation nor baseline currency.

## 2026-10-03 test-contract priority amendment

An installed Lervo review of `document-normalization-procedure.test.ts` received the background-owner ADR but missed the later document-normalization contract's turn-owned compatibility rule. The generator correctly retained `needs_review`; a bounded retry with the same context could not resolve it.

For source paths ending in `.test` or `.spec` followed by a supported JavaScript or TypeScript extension, query stem terms plus `contract` before the ordinary stem query. Within existing document and byte bounds, follow direct child Markdown contracts from source-specific query hits before unrelated recommendation children. Retain exact hashes, policy filtering, and independent review. This changes review-input ordering only; neither a test nor context probe proves installed approval or baseline currency.

The same installed run reviewed `knowledge-worker-command.ts` without the already integrated CLI wrapper contract because a generic worker query ranked it beyond the four-hit window. For CLI knowledge-command sources, query basename terms with `cli wrappers` before the generic basename query. Link the wrapper contract from the runtime entrypoint. The independent reviewer must still resolve the rejected wrapper draft; a source-specific hit grants no approval.

## 2026-10-03 integrated adapter contract amendment

After an approved CLI repository-change adapter document was integrated, a restarted baseline reviewed the same adapter sources against a knowledge index that had not yet migrated the new document. It proposed another document for the same responsibility.

Migrate integrated canonical documents before relying on the index for a restarted review. For CLI repository-change adapter sources, query `repository change adapter boundaries` before generic basename terms within the existing context limits. Exact source and document hashes and independent approval remain required. An older approval that omitted the document cannot authorize a duplicate integration after source or context changes.
