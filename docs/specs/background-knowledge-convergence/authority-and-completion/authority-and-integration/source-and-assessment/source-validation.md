# Source validation and context

Before reading source, validate the complete manifest schema, artifact digest and byte count, project and source-event identity, revision and path count, safe relative paths, and supported coordinate kinds. Resolve paths without escaping the repository through links. Recover committed before-bytes from pinned trees, not merely the last four commits. Record unavailable dirty before-bytes as explicit evidence gaps.

Load the applicable instruction hierarchy and bounded canonical recommendations. Read exact bytes and bind their hashes. Missing required instructions, invalid encodings, or excess input fail with bounded context reasons. Never truncate instructions or source to fit a provider request. Keep source paths and text in private review input, outside public events.

[ADR-0443](../../../../../decisions/knowledge/repository/canonicalization/0443-load-linked-child-contracts-for-canonical-review.md) adds at most four direct child Markdown contracts linked from selected canonical candidates after the eight ranked recommendations. The combined context is limited to 12 documents and 1 MiB and binds exact child hashes through the same settlement fence. Linked context provides independent-review evidence; it neither proves semantic coverage nor approves a draft.

The four-document allowance also includes direct local `docs/*.md` links from loaded instruction documents, after canonical child contracts. Every linked instruction target must pass policy, path confinement, byte, and exact-hash checks before either review call. A missing selected target fails context loading; its link never proves coverage.
