# Canonical rejection

[ADR-0479: Park rejected semantic candidates](../../../../../../decisions/knowledge/semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md) replaces the [ADR-0435](../../../../../../decisions/knowledge/repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md) handoff. A rejection never stops the obligation.

A rejected workset is re-assessed once with the reviewer's rationale as `independentReviewFeedback`. If the workset is rejected again, it is halved at the same cursor, and the isolation span limits later worksets until the cursor passes it. Each isolated workset has its own batch budget and one re-assessment. A rejected single source is parked as `review_rejected`, and the cursor moves past it. A single source that its generator marked `needs_review` is parked at once as `owner_decision`.

A rejected or parked proposal authorizes no integration and never becomes semantic coverage. Later worksets skip carried parked sources whose bytes are unchanged. Final lifecycle verification excludes parked sources from the required coverage. If everything else is complete, it records `attention_required/knowledge_sources_parked`.

An exact rejection recorded before an upgrade is reused without another review call when its queued successor binds the same predecessor, snapshot, and assessment hash.
