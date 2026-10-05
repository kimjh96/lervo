# Semantic evaluation recovery

Semantic evaluation permits at most two attempts. A second attempt requires `ManagedProviderRunError` with one of these failures:

- `provider_start_failed`
- `provider_stream_failed`
- `provider_turn_failed`
- `provider_model_unavailable`
- `provider_result_failed`
- `repository_snapshot_failed`

Other failures propagate without retry.

Each attempt uses the normal runner and budget, relationship `publication_evaluation`, its attempt ordinal, and the requested structured-output schema. The evaluation request is materialized as a workspace document; the response passes through the semantic evaluation parser.

Recovery retries the evaluator, not the writer. It does not establish successful publication or convergence.
