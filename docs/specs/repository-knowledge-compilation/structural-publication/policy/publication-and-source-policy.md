# Publication and Source Policy

Tracked `.lervo/knowledge/policy.yaml` includes:

```yaml
publicationRoot: docs/knowledge
publication:
  language: en
  maxNavigationEntries: 24
  maxNavigationBytes: 8192
normalization:
  exclude: []
limits:
  maxFiles: 20000
  maxFileBytes: 1048576
  maxTotalBytes: 67108864
```

V1 supports only `en`. Language affects generated prose and titles, not identities or user bytes. Neutral localized labels preserve exact encoded paths. Unsupported values fail before planning.

The 64 MiB aggregate byte bound covers ordinary repository sources and the independently bounded execution-event and verification-result supplemental corpora. The scanner applies this bound after each admitted source and fails closed on overflow. Supplemental adapters retain stricter per-source, count, and 16 MiB per-corpus limits.

A bounded tracked `normalization.exclude` list may exclude governed user documents only from provider rewriting; structural compilation and query retain them. Exact patterns remain policy-hash inputs and never become scanner exclusions.
