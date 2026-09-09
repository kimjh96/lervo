# Response failures

Response errors pass through a provider-neutral classifier before persistence. Retryable work has an explicit attempt bound. Exhausted or non-retryable work produces a fixed, deterministically verified terminal status instead of remaining silent.
