# ADR-0546: Capture in-repository links without a reviewed declaration

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0436](../canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md) (symbolic references)

## Context

[ADR-0436](../canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md) captures a tracked symbolic link only when the reviewed delegation lists it under `sourceCapture.symbolicReferences`. Any other tracked link stops source capture with `knowledge_source_kind_unsupported`.

Provider skill surfaces are tracked links. For example, `.claude/skills/<name>` points to `../../.agents/skills/<name>`. Each new portable skill adds one. On 2026-11-01, every resident cycle on the Mac checkouts of `lervo` and `axli` failed at source capture for this reason. Convergence there had stopped without a visible cause. Adding each new link to the delegation would make every skill a delegation review, and the owner is not a review queue.

## Decision

Source capture derives a reference for a tracked link the delegation does not declare. The derived reference is captured exactly like a declared one: its descriptor is hashed, and its target is never followed or read through the link.

- A declared reference wins over a derived one for the same path.
- A derived reference is allowed only when the stored target is relative, normalizes inside the repository, stays outside `.git` and `.lervo`, and names an existing file or directory. Any other link still fails with `knowledge_source_kind_unsupported`.
- Derived references pass the same target-capture check as declared ones. The file target, or every directory descendant, must appear in the complete Git-governed inventory. Link chains remain unsupported.
- The 32-reference limit still bounds only the reviewed declaration. Derived references are bounded by the existing 20,000-path inventory limit.

## State, events, privacy, and failure meaning

No field, event, or state is added. The baseline already records link descriptors as sources. `knowledge_source_kind_unsupported` keeps its meaning for links that escape the repository, reach private metadata, dangle, or form a chain.

## Verification

- `packages/repository-knowledge-runtime/test/source-capture-policy.test.ts` captures an undeclared in-repository link and keeps escaping, `.lervo`, and chained links unsupported.
- Capture over the real Mac checkouts of `lervo` (8,344 sources) and `axli` (4,098 sources) completes.
