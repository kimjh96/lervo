# Provider-neutral grounding runner observation v1

Status: `observed`
Observation date: 2026-08-27

## Scope

This observation runs 32 checked-in conversational grounding cases with the deterministic `provider-neutral-grounding-v1` runner. The runner is outside `@lervo/search`, imports no Codex or Claude adapter, and derives intent, reference, source class, disposition, required behavior, and prohibited behavior from public fixture prompts and bounded context.

The `verification_authored`, `pending_human_review` suite demonstrates conformance only to checked-in expectations. Passing does not prove production representativeness, provider understanding, answer correctness, managed delivery, or search-engine activation authority.

## Protocol

```sh
pnpm evaluation:grounding:run -- --json
pnpm exec vitest run scripts/evaluation/test/grounding-runner.test.mjs scripts/evaluation/test/natural-language-evaluation.test.mjs
```

Before execution, the evaluator validates the suite. It invokes the resolver without case expectations and compares six dimensions independently; source classes and behavior collections are set-compared. The deterministic report contains only case IDs, categories, Boolean verdicts, bounded failure meanings, digests, and counts.

## Result

Report `ngreport_063cedf698ab4d7d0416cf12` binds suite digest `sha256:8b530e54edead6e8076a5a0b5f83a9ac5c5a70370826584971cc6970780dcec5`.

| Dimension | Passed | Total |
| --- | ---: | ---: |
| Intent | 32 | 32 |
| Reference resolution | 32 | 32 |
| Source classes | 32 | 32 |
| Disposition | 32 | 32 |
| Required behaviors | 32 | 32 |
| Prohibited behaviors | 32 | 32 |

All eight categories passed four of four cases. Focused tests also prove:

- One incorrect intent does not alter reference or disposition verdicts.
- Mixed-language shorthand still requires a recognizable subject.
- Missing continuation state resolves through a current canonical roadmap; absence of both a workstream and recovery source abstains.
- Ambiguous approval clarifies.
- Report identity is deterministic.

Eleven expected unresolved-coordinate cases report `expectation_unresolved`; the hash-drift case reports `expected_version_stale`. These are correct fail-closed outcomes, not failed case verdicts.

## Privacy and evidence boundary

The report excludes prompt text, prior-turn text, absolute paths, source bodies, and judge rationale. It emits no execution event and does not alter selected, loaded, injected, referenced, or used evidence. It neither calls nor judges a provider answer.

## Disposition

At observation time, keep `lexical-v1` operational and `local-hybrid-v1` inactive. ADR-0226 later retired the hybrid candidate. The runner completes the initial deterministic grounding implementation step, but human review of exact cases and real lexical failures remains required before any production-quality or fallback-activation decision.

All 20 Korean-English retrieval pairs and 32 grounding cases have complete agent pre-review but lack human acceptance. Four benchmark lexical failure candidates cover only three task types. Three public Korean historical-rationale discovery probes reproduce operational lexical no-hit results, but remain verification-authored and do not complete real-use coverage. Next, obtain explicit human review, accept or revise an exact historical-rationale probe, and replay only an accepted bundle. Context-delivery attrition and answer-grounding judgment remain separate later work.

See [ADR-0224](../../decisions/search/0224-natural-language-grounding-quality-evaluation.md), the [natural-language case pre-review](natural-language-case-pre-review-v1.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).
