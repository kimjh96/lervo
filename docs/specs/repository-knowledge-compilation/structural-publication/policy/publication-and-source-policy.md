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

V1 supports only `en`; unsupported values fail before planning. Language affects generated prose and titles, not identities or user bytes. Neutral localized labels preserve exact encoded paths.

The 64 MiB aggregate byte bound covers ordinary repository sources and the independently bounded execution-event and verification-result supplemental corpora. The scanner lists candidates before reading and admits them in the [priority order](../sources/discovery-and-units.md#total-byte-admission-and-coverage), reporting partial coverage for sources that do not fit. Currency-claiming consumers retain the `knowledge_source_limit_exceeded` stop; read-only consumers accept the admitted subset. The default never rises automatically; a repository may explicitly raise its policy limit. Supplemental adapters retain stricter per-source, count, and 16 MiB per-corpus limits.

A bounded, tracked `normalization.exclude` list may exclude governed user documents only from provider rewriting. Structural compilation and query retain them. Exact patterns remain policy-hash inputs and never become scanner exclusions.
