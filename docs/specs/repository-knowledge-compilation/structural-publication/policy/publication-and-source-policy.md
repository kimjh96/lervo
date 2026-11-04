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

The 64 MiB aggregate byte bound limits retained content across ordinary repository sources and the independently bounded execution-event and verification-result supplemental corpora. The scanner observes every eligible text source, computing its content hash, byte count, and line count, and retains content in the [priority order](../sources/discovery-and-units.md#total-byte-admission-and-coverage). A source that does not fit releases its text and remains included with `contentRetention: observed_only`, its content hash, and one whole-source unit. It has no fine-grained extracted units. Coverage is complete when every eligible source has a content hash and all knowledge-class sources in priority classes 1–4 are retained. Observed-only code and execution evidence report a search-depth gap without making coverage partial. When knowledge-class content cannot be retained, coverage is partial: currency-claiming consumers stop with `knowledge_source_limit_exceeded`, while read-only consumers accept the partial scan and report its limits. The default never rises automatically; a repository may explicitly raise its policy limit. File eligibility rules remain unchanged. Supplemental adapters retain stricter per-source, count, and 16 MiB per-corpus limits.

A bounded, tracked `normalization.exclude` list may exclude governed user documents only from provider rewriting. Structural compilation and query retain them. Exact patterns remain policy-hash inputs and never become scanner exclusions.
