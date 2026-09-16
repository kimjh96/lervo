# Goal resource observation

Goal resource observation includes causally bound owner runs without assignments and their descendants. These runs do not become worker attempts. Their events invalidate the task digest, active runs consume capacity, and missing usage cannot be treated as zero.

A complete aggregate requires either one provider-reported accounting group covering every causal run or the narrow default-model comparability proof in ADR-0400, linked from the [admission entrypoint](../admission.md).

That proof accepts exactly two complete primary-provider groups whose exact descriptors differ only by a null versus explicit requested model. Every final run observation must prove the same single actual model, equal to the explicit request, with identical remaining accounting semantics and exact run coverage.

Original reporting groups remain separate; only the supervision mandate total is derived. Distinct providers, descendant scopes, missing evidence, aliases or other descriptor differences remain unavailable. No usage or reservation is reset.
