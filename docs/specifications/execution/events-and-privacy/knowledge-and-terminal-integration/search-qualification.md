# Product-default search qualification

`context.recommended` may include `productQualificationId` when the shipped product default selected the search engine. The value is an opaque `spqual_` content coordinate, mutually exclusive with a repository-local `selectionTransitionId` on its source search attempt. It contains no query, corpus, path, source body, provider output, or credential.

Presence proves only product-default selection of the bound engine build; historical absence means the qualification was unobserved. Invalid, missing, or mismatched qualification prevents the non-baseline attempt and recommendation from being recorded.
