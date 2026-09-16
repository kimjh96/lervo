# Search engine boundary

## Ownership and default

Operational retrieval uses `SearchEnginePort` and `SearchIndexPort`. Product-qualified `lexical-v2` is the no-transition default; `lexical-v1` is the local rollback baseline. Engine adapters own only indexing and ranking. Corpus acquisition, query grounding, context selection, provider delivery, credentials, and network authority remain outside these ports.

Registered `lexical-v2` build `sebuild_e9f2ac9398b0f58d03143e7a` passed the v20 local and cross-provider engineering gates. A provider-neutral projection and independent-query fusion plan also passed all four exact human-reviewed real-use cases for both providers. ADR-0328 established the initial product default; ADR-0353 replaced its admitted projector pair with the reviewed direct pair.

Current qualification `spqual_18bb11bf0b6a01f9a33190bc` content-binds engine evidence, direct-projector evidence, exact shipped builds, and verified superseded product-plan lineage. Every current repository uses that engine and complete plan by default without repeating project-specific evaluation. ADR-0321 remains the immutable selection boundary for a different repository-specific complete plan.

## Alternative engines and adapters

Any other local engine or external adapter must:

1. Implement the provider-neutral port with distinct engine identity and content-bound adapter build identity.
2. Register in the bounded registry; registration has no runtime effect.
3. Be compared with `lexical-v1` on the same corpus and cases.
4. Have quality, latency, privacy, and cost evidence reviewed.
5. Be activated through an immutable policy-bound transition.
6. Revalidate its adapter build, corpus, comparison, review, index, and response during every operational resolution.
7. Roll back explicitly to `lexical-v1` when required by the reviewed transition.

Selected-adapter failure is fail-closed: runtime must not silently mix engines or fall back. Explicit rollback restores the local baseline without a Hub, external credential, or network service.

External engines belong in adapter packages. Core search, context, and provider orchestration must not import vendor SDKs or depend on Codex or Claude behavior. Credentials and network capability require separate authorization; secret bytes remain runtime-only.

Reranking, query expansion, remote corpora, and context expansion require separate measurable, observable boundaries. Engine adapters must not hide them to bypass comparison or review.
