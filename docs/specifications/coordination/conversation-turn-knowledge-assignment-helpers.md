# Conversation turn knowledge-assignment helpers

## Responsibility

`apps/node-runtime/src/conversation-canonicalization-assignment.ts` reads pending canonicalization and normalization assignments and renders instructions for a write-capable conversation turn. This turn-owned compatibility surface does not prove that autonomous background convergence has completed.

## Canonicalization instructions

The reader selects only candidates with observed state `candidate` or `stale`, retaining their exact candidate hash, source paths, and recommended roots. An unreadable candidate registry returns an empty list.

The renderer returns null for an empty list and renders at most eight candidates, displaying at most eight source paths per candidate. It instructs the turn to resolve candidates after requested work unless the current request is read-only research:

- For a stale candidate, it supplies an exact-hash reject command.
- For a current candidate, it directs the agent to update a compatible canonical document and promote against its final target hash, or reject when no durable documentation is needed.

These instructions neither independently authorize canonical writes nor establish successful promotion. Applicable assignment, ownership, approval, and integration boundaries still govern effects.

## Normalization and read failures

A non-null normalization review is rendered through `storedNormalizationReviewProcedure`; this helper does not define that procedure's approval rules. A null review produces no normalization instruction.

`readKnowledgeAssignments` reads canonicalization candidates and the optional normalization review concurrently. Missing normalization support or a failed normalization review returns null. Empty or null assignment input does not prove that the repository has no debt, its registries are healthy, or knowledge is current.
