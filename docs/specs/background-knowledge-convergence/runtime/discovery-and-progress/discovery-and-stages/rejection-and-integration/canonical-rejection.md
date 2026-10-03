# Canonical rejection

[ADR-0435: Continue normalization after canonical rejection](../../../../../../decisions/knowledge/repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md) retains rejected canonical batches and routes independent normalization debt to its own review pipeline.

The `canonical_review` receipt binds a private `rejection_retained` proof and authorizes no integration. Exact historical rejections are reused without another model call.

Ordered projection maintenance may proceed, but final lifecycle verification remains `attention_required/knowledge_semantic_review_rejected`. Rejected and unassessed sources count toward neither semantic coverage nor baseline `current`.
