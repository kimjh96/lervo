# Canonicalization assessment and durable outcomes

## Responsibility and placement

Every repository-changing completion assesses durable outcomes using typed source responsibility, ownership, changed paths, verification, and lifecycle coordinates. Natural-language keyword maps grant no workflow, effect, or write authority.

Behavioral obligations belong in canonical instruction documents. Product, architecture, and lifecycle facts belong in their responsible specification or decision. Executable obligations belong in verification. Mutable next steps belong only in the current workstream. AGENTS is a fixed-size behavioral bootstrap, not a route list or general knowledge store; repository knowledge query supplies task- and path-scoped routing.

## Snapshot and evidence bounds

Terminal preparation records a bounded repository path/hash snapshot in ignored local state. Final declaration compares it with current bytes, classifies changed paths through typed responsibility rules, and automatically records a bounded candidate when implementation or provider-surface evidence lacks a matching changed canonical target. Candidate records contain hashes and typed coordinates, never prompt text or phrase mappings.

The repository snapshot limits assessment input to 20,000 entries. A large refactor may change more than 256 paths when matching canonical responsibilities change in the same turn; assessment stores no per-path evidence for a current result. A candidate is limited to 256 unmatched source bindings and fails closed before writing if that bound is exceeded.

## Review states and promotion

Assessment reports `current` or `candidate`; candidate inspection also observes `pending`, `promoted`, `rejected`, and `stale`. Defer and reject require an exact candidate hash and reviewer identity. Promotion additionally requires an exact current canonical-target hash with the same responsibility and never writes the target.

A canonicalization candidate is review evidence, not canonical truth or approval. Repetition, provider agreement, candidate generation, and file presence never automatically promote user-owned content.

Under [ADR-0561](../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), only the background canonical reviewer, which must not be the agent that wrote the change, defers, rejects, or promotes a candidate. No candidate waits for the owner:

- `lervo knowledge canonicalization review` and `promote` are removed. Each fails with one line naming the undo, `lervo knowledge canonicalization reopen <candidate-id>`. Reopen returns a promoted, rejected, or held candidate to `candidate`, so the reviewer judges it again. Canonical documents are restored from Git.
- A reviewer deferral regenerates the review once, with the deferral as `priorDeferral` evidence. A second deferral records the candidate as `pending` with a `defer` review. That candidate is held as Lervo debt. It is neither reviewed again nor counted as convergence debt until its sources change or it is reopened. Attention shows it with its age and owner `reviewer`.
- A new declaration cannot claim `pending_user_approval`. A stored one opens an ordinary `candidate`, and an older `pending` record without a review is reviewed like any candidate.

## Direct-terminal durable outcomes

Repository-changing direct-terminal declarations also carry a bounded local durable outcome. It binds every changed noncanonical source exactly once to an exact changed canonical target, a reviewable no-durable-change rationale, or a responsibility-compatible proposed Markdown draft. Candidate bodies stay out of events and operating-attention output; exact hashes, target paths, and review state remain inspectable. See ADR-0362 in the [specification references](../repository-knowledge-lifecycle-convergence.md).

New declarations accept only `canonical_update` and `no_durable_change`. Under ADR-0561 the agent writes canonical bytes itself instead of proposing a draft for the owner, so the `review_draft` outcome parses only in stored candidates. [ADR-0533](../../decisions/knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md) removes portable-skill candidate intake. Stored declaration events never contained the outcome body; their read contract is unchanged.

Promotion verifies already-authorized canonical bytes and never implicitly overwrites user-owned content.
