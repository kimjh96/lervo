# Terminal coverage

`lervo terminal coverage` is rebuildable. Preparation is diagnostic; managed delivery is unavailable without an adapter receipt; explicit reference is nullable when Stop output is unavailable; relevance is nullable without ground truth. No combined score exists.

Each observed turn reports `selectedCount`, `referenceCount`, and `pathMentionCount` from its closing event. Missing later counts remain null for historical events. The report validates reference and path-mention counts against their event IDs. Compact pointers and query selections can produce path references with zero loaded documents. These references establish output-reference availability but do not change loaded-document delivery ratios. The CLI labels path mentions as a proxy and states that they prove neither reading nor reliance.

Terminal coverage keeps resource meanings separate:

- Whole-task provider usage is always `unavailable` with `unmanaged_provider_usage_unobserved` because direct provider execution is outside the managed adapter boundary.
- Usage directly retained by the query-projection receipt is reported separately as `partial` with `accounting_descriptor_unavailable`; a missing receipt counter is `query_projection_usage_unavailable`.

Neither value is billed cost.
