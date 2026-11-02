# Authority and independent review

## Delegation and assignments

A reviewed repository delegation binds project identity, active agent ancestry, role version and hashes, permitted canonical roots and normalization scopes, capability and verification contracts, integration target, expiration or revocation, and resource ceilings. Empty or legacy delegations permit inspection only. This design creates no delegation for an installed project.

Long convergence stages retain their exact assignment lease through bounded renewal under [ADR-0359](../../../../decisions/execution/verification/0359-renew-assignment-leases-during-long-verification.md). Renewal preserves claim generation, requires the current stage lease, and stops before assignment settlement. The generic 30-minute maximum remains unchanged.

The coordinator registers each worker with its parent and claims a scoped assignment. Semantic reviewers have read-only authority, no exclusive write-path lease, and a physically isolated no-capability process. Writers receive a separate narrow assignment and the ordinary workspace lease. Recommendations and role templates grant neither assignment nor write authority.

## Independent review and assessment

Normalization review is separate from generation, with a distinct durable reviewer identity and no shared provider session. Another provider is optional, must already be permitted, and guarantees no correctness. Review validates meaning, requirements, examples, links, lifecycle metadata, protected regions, skill identity, and resource bindings. Structural coverage alone is insufficient.

If a reviewer response fails the exact candidate, source-unit, and output-hash contract, the reviewer may make one fresh independent call within the same durable batch call ceiling. The invalid response grants no approval. A second invalid response or exhausted budget retains explicit review attention; neither path edits the candidate or raises the approved ceiling.

If a canonical assessment response fails its exact source, hash, or reference contract, the generator may make one fresh call within the existing three-call stage ceiling. The invalid response establishes no coverage or candidate. A second invalid response or exhausted budget retains explicit assessment attention.

Old canonicalization candidates are reviewed one at a time. Each review loads source-specific canonical context for the candidate's exact source bindings. Unrelated candidates cannot consume the bounded document slots or make a present contract appear missing. A stale candidate closes only its old binding; a current candidate requires substantive source coverage before promotion or rejection. Under [ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), a deferral no longer stops the obligation with `knowledge_semantic_review_rejected`. The review regenerates once with the deferral as `priorDeferral`, and a second deferral holds the candidate as Lervo debt while convergence continues.

## Approval and application

Each accepted item has an exact approval binding original source, candidate and output hashes, source-unit coverage, skill resources, compiler build, policy, language, format, reviewer assignment, verification, and current delegation. Rejected items retain a bounded reason and remain unapplied. Applying stored candidates never invokes the generator again.

Conflict with user-owned material or a requested decision lacking authority creates one content-bound decision, without repeated permission prompts or silent rewriting.

This agent review requires the proposed ADR-0434 amendment to the existing semantic-approval policy. Existing approvals cannot imply standing delegation.
