# Initial retrieval and grounding

Paired suites used the same 263-document corpus digest. Korean Success@10 was 19/20 for both engines; English controls were 17/20 for `lexical-v1` and 18/20 for `local-hybrid-v1`. Both aggregate decisions failed, neither engine passed every task-type gate, and English had one ranking regression. Operational search remained `lexical-v1`. See the [Korean retrieval observation](../../evidence/search/korean-repository-retrieval-v1.md).

The 32-case suite records typed observations for intent, reference resolution, source classes, disposition, and required and prohibited behaviors. It covers fresh-clone recovery, missing-source failure, Korean, mixed-language, shorthand, indirect references, ambiguity, approval, hash drift, and unreviewed graph recommendations. The removed phrase-list resolver reproduced the routing defect. The suite cannot prove every future provider response correct.

[Agent pre-review](../../evidence/search/natural-language-case-pre-review-v1.md) covered all 20 retrieval pairs and 32 grounding cases: 43 were ready for human review, while nine had explicit attention reasons. Same-corpus replay found four lexical-failure candidates across three task types and one English hybrid rank regression. Three public Korean historical-rationale probes produced operational lexical no-hits, but they are neither human-reviewed nor real-use evidence; real-failure coverage remains incomplete. Provenance and review status did not change.

Fresh reports reproduced the result. Korean-only probes placed the expected English ADR at rank 15 once and outside the top 50 twice. ADR-0225 kept `local-hybrid-v1` inactive and required revision instead of fusion-weight tuning or fixture-specific bilingual aliases.
