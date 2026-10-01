# Authority and independent review

A reviewed repository delegation binds project identity, active agent ancestry, role version and hashes, permitted canonical roots and normalization scopes, capability and verification contracts, integration target, expiration or revocation, and resource ceilings. Empty or legacy delegations permit inspection only. This design creates no delegation for an installed project.

Long convergence stages retain their exact assignment lease through bounded renewal under [ADR-0359](../../../../decisions/execution/verification/0359-renew-assignment-leases-during-long-verification.md). Renewal preserves the claim generation, requires the current stage lease, and stops before assignment settlement. The generic 30-minute maximum is unchanged.

The coordinator registers each worker with its parent and claims a scoped assignment. Semantic reviewers have read-only authority, no exclusive write-path lease, and a physically isolated no-capability process. Writers receive a different narrow assignment and the ordinary workspace lease. Recommendations and role templates grant neither assignment nor write authority.

Normalization review is separate from generation, with a distinct durable reviewer identity and no shared provider session. Another provider is optional, must already be permitted, and gives no correctness guarantee. Review validates meaning, requirements, examples, links, lifecycle metadata, protected regions, skill identity, and resource bindings. Structural coverage alone is insufficient.

If a reviewer response fails the exact candidate, source-unit, and output-hash contract, the reviewer may make one fresh independent call within the same durable batch call ceiling. The invalid response grants no approval. A second invalid response or exhausted budget retains explicit review attention; neither path edits the candidate or raises the approved ceiling.

Each accepted item has an exact approval binding original source, candidate and output hashes, source-unit coverage, skill resources, compiler build, policy, language, format, reviewer assignment, verification, and current delegation. Rejected items retain a bounded reason and remain unapplied. Applying stored candidates never invokes the generator again.

Conflict with user-owned material or a requested decision lacking authority creates one content-bound decision, without repeated permission prompts or silent rewriting.

This agent review requires the proposed ADR-0434 amendment to the existing semantic-approval policy. Existing approvals cannot imply standing delegation.
