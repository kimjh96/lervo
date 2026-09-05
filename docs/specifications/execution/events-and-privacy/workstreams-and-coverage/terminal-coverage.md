# Terminal coverage

`lervo terminal coverage` is rebuildable. Preparation is diagnostic; managed delivery is unavailable without an adapter receipt; explicit reference is nullable when Stop output is unavailable; relevance is nullable without ground truth. No combined score exists.

Terminal coverage keeps resource meanings separate:

- Whole-task provider usage is always `unavailable` with `unmanaged_provider_usage_unobserved` because direct provider execution is outside the managed adapter boundary.
- Usage directly retained by the query-projection receipt is reported separately as `partial` with `accounting_descriptor_unavailable`; a missing receipt counter is `query_projection_usage_unavailable`.

Neither value is billed cost.
