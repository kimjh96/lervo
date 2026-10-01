# ADR-0443: Load linked child contracts for canonical review

Status: `accepted`
Decision date: 2026-09-29

## Context

Shiflo's installed screenshot-kit review rejected a generator supplement at event 9385. Its canonical context included `reproduction.md` but omitted three linked child contracts for preview capture, composition, and invocation. The eight-document recommendation window was full, and lexical recommendations omitted those child paths. The reviewer correctly refused to infer their contents from links or an introductory quotation.

## Decision

After loading the instruction hierarchy and at most eight ranked recommendations, load up to four direct Markdown child documents linked from selected canonical candidates. Each child must resolve inside a directory named for its parent document, such as `reproduction.md` to `reproduction/*.md`. Reject path escapes and nonlocal links. Follow only ordinary paths allowed by the current repository knowledge policy; skip sensitive, excluded, and generated-publication paths.

Read every selected child through the repository-confined file boundary and bind its exact content hash for the existing settlement fence. Combined context must not exceed 12 documents or 1 MiB of UTF-8 text. Exceeding the byte bound fails with `review_context_limit_exceeded`; missing or unreadable selected children fail with `review_context_unavailable`.

This provides routed contract bytes to both generator and independent reviewer. It does not establish semantic coverage or approve a draft. The reviewer must still verify exact source facts and substantive canonical quotations. The prior rejection remains unresolved until a fresh installed review accepts the corrected input.

## Verification and limits

A focused loader regression exercises a full recommendation window, three linked child contracts, an excluded sensitive child, remote and escaping links, and aggregate byte refusal. A real Shiflo context probe must include all three formerly missing paths with exact bytes. Repository quality, documentation, and task-base release checks remain required for this bundled-private change. Shiflo's installed approval, current lifecycle receipt, and Lervo's complete four-shard apply are separate observations.

No new public event, state, provider permission, or document write is introduced. Paths and text remain private review input; public evidence retains bounded hashes and failure codes.

## 2026-10-01 linked instruction amendment

Lervo's installed review of the commit-convention workflow rejected a draft because `AGENTS.md` linked `docs/foundation/commit-convention.md`, but the bounded ranked context omitted that document. A link alone could not prove whether the existing convention already covered the workflow. Within the same four additional-document and 1-MiB bounds, include direct local `docs/*.md` links from loaded instruction documents after linked child contracts. Apply the same repository policy, confined read, and exact hash binding. Do not follow remote links or paths outside `docs/`. This supplies evidence for assessment and independent review without accepting a draft or claiming baseline currency. A focused test binds the linked instruction's exact bytes; installed review must still pass independently.
