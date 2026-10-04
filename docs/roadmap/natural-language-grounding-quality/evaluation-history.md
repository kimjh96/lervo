# Natural-language grounding evaluation history

History of retrieval, grounding, Phase A, provider-shadow, managed-canary, and paired uplift evaluations. Operational search used `lexical-v1` throughout these evaluations. Qualified Lexical v2 is now the shipped default for repositories without an explicit reviewed local selection; see the [current grounding roadmap](../natural-language-grounding-quality.md).

ADR-0302 retired the ADR-0301 ordinary linked default because paired uplift failed to establish an accuracy or cross-provider token benefit. The exact canary remains default-off historical infrastructure.

- [Initial retrieval and grounding](evaluation-history/initial-retrieval-and-grounding.md)
- [Delegated and bounded retrieval](evaluation-history/delegated-and-bounded-retrieval.md)
- [Assisted retrieval iterations](evaluation-history/assisted-retrieval-iterations.md)
- [Phase A delivery](evaluation-history/phase-a-delivery.md)
- [Provider-shadow and managed-canary delivery](evaluation-history/provider-shadow-delivery.md)
- [Managed-context canaries](evaluation-history/provider-shadow-managed-context-canaries.md)
- [Lexical-only versus linked-context uplift](../../evidence/search/paired-uplift/lexical-linked-uplift-v1.md)
