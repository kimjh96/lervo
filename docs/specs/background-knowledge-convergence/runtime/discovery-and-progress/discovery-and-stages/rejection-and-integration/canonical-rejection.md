# Canonical rejection

[ADR-0479: Park rejected semantic candidates](../../../../../../decisions/knowledge/semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md) replaces the [ADR-0435](../../../../../../decisions/knowledge/repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md) handoff. Rejection never stops the obligation.

A rejected workset is re-assessed once with the reviewer's rationale as `independentReviewFeedback`. If rejected again, it is halved at the same cursor; the isolation span limits later worksets until the cursor passes it. Each isolated workset has its own batch budget and one re-assessment. A rejected single source is parked as `review_rejected`, and the cursor moves past it. A single source marked `needs_review` by its generator is parked immediately as `owner_decision`.

Rejected or parked proposals authorize no integration and never become semantic coverage. Later worksets skip carried parked sources with unchanged bytes. Final lifecycle verification excludes parked sources from required coverage. If everything else is complete, it records `attention_required/knowledge_sources_parked`.

An exact rejection recorded before an upgrade is reused without another review call when its queued successor binds the same predecessor, snapshot, and assessment hash.
