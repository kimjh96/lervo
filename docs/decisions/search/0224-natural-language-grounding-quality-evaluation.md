# ADR-0224: Natural-language grounding quality evaluation

Status: `accepted`
Decision date: 2026-08-27

## Context

Requests such as “OO 작업 하자,” “진행,” “다음 작업 진행해줘,” and “예전에 왜 이런 작업을 했었지?” may require execution, inspection, an evidence-backed answer, clarification, or abstention. The correct response depends on the prior turn, current workstream, repository state, and approval binding.

The existing benchmark measures deterministic query-to-ranked-source quality but cannot represent conversation history, deictic references, current workstreams, response disposition, authority, fail-closed behavior, or final-answer grounding. Adding these concerns to `SearchEvaluationCase` would couple deterministic search identity to conversational policy and provider behavior.

Because the corpus is overwhelmingly English, Korean-framed queries containing English repository terms test whether those anchors survive Korean framing, not general Korean-to-English semantic retrieval.

## Decision

### Keep retrieval and grounding evaluation separate

Repository retrieval remains a deterministic search-engine evaluation. The checked-in Korean suite contains 20 `verification_authored` cases: five each for task starts and how-to requests, historical rationale, status or impact, and ambiguity or contract boundaries. Its one-to-one English control uses the same task type, expected paths, maximum rank, and corpus; only language and framing differ.

Both suites exclude this decision, its roadmap, search evidence, and generated knowledge from the corpus so their contracts and results cannot affect ranking. Run them separately against the same corpus state; never aggregate them into one adoption gate. Pre-register expected paths before observing candidates. A Korean-framed win containing an English repository anchor is not cross-lingual evidence.

Conversational grounding uses `benchmarks/grounding/natural-language-repository-v1.json`. Its 32 `verification_authored` cases cover task start, historical rationale, status and continuation, deictic reference, ambiguity and abstention, mixed language/shorthand/typo, approval and authority, and fail-closed grounding, with exactly four cases per category. Prompt text may repeat only when context differs because context-sensitive disposition is required capability, not duplicate fixture noise.

### Score four decisions independently

Evaluate these independently rather than reducing a case to “understood”:

1. intent resolution;
2. reference resolution;
3. grounding source class; and
4. response disposition.

Allowed source classes are user or conversation context, repository instructions, current workstream, durable decisions, repository state, knowledge projections, and execution evidence. Knowledge projections are recommendations and never replace canonical source bytes. Allowed dispositions are answer, inspect then execute, clarify, abstain, or resolve an exactly bound approval.

Reference resolution distinguishes a current workstream from `repository_roadmap`. The latter is valid only when no current workstream exists, repository sources are current, and the fresh-clone instruction route can recover the next bounded scope from the canonical roadmap. It requires current-state inspection, canonical-source reading, and scope preservation. Without a workstream or matching recovery source, the request remains unresolved and abstains.

Every case declares required and prohibited behavior. Clarification and abstention require explicit no-guess behavior. An unresolved reference cannot execute. Approval resolution requires exactly one current binding. Hash drift, absent authority, an absent workstream, no matching source, and an unreviewed graph relation fail closed.

### Preserve engine, evidence, and activation boundaries

Natural-language interpretation must not enter `@lervo/search`, engine scores, index identity, result-set hashes, `SearchAttempt`, or graph ranking. Prompt history, current-workstream resolution, context assembly, byte budgets, response judging, and abstention remain outside the search engine.

Grounding quality is not activation authority. Passing a case cannot promote selected content to loaded, injected, referenced, or used, and cannot activate `local-hybrid-v1`. Operational search remains `lexical-v1` until reviewed production-like failures, every task-type quality gate, zero baseline regressions, replay, policy, and explicit rollout review all pass.

### Bind privacy and review provenance

Checked-in prompts and prior turns are public fixtures. Runtime events retain only digests and bounded coordinates. Reports exclude prompt text, prior-turn text, absolute paths, source bodies, and judge rationale. Future answer artifacts must be separately content-addressed; reports may retain their digest but not unrestricted output.

`verification_authored` means repository-authored test input, not human-reviewed production evidence. Only explicit later review may change provenance or authorize a production-quality claim.

No execution event or evidence state is added. `reviewStatus=pending_human_review` describes the checked-in suite, not a durable approval event.

Human review gates provenance promotion, production-quality claims, and activation. It does not block read-only failure diagnosis or a conservative decision to keep a failing candidate inactive. A generic continuation request is not case-level approval, and normal engineering must not require the user to inspect or approve a bulk fixture set.

## Failure meanings

The checked-in validator fails for an invalid suite, mismatched pair, stale or absent expected path, incorrect category cardinality, unsupported source class, unresolved executable reference, roadmap resolution while a workstream is present or canonical recovery is unavailable, approval without exactly one binding, or a fail-open hash-drift case.

A later runtime evaluator must preserve these failures:

- `expectation_unresolved`: reviewed expected coordinates cannot be resolved;
- `expected_version_stale`: an expected source version differs from current bytes;
- `judge_unavailable`: a separately configured semantic judge could not run;
- `judge_invalid`: judge output violates its bounded contract;
- `answer_artifact_missing`: the evaluated answer digest has no current artifact;
- `budget_truncated`: required context was removed by a declared delivery budget.

These are not search failures and do not imply model use.

## Verification

`pnpm evaluation:natural-language:check` validates the public corpus, exact category counts, paired ground truth, current expected paths, authority rules, no-guess dispositions, privacy declaration, fresh-clone roadmap recovery, and fail-closed cases. It binds agent pre-review to exact suite digests, requires each case to occur in exactly one review partition, and rejects inaccurate lexical-failure task coverage or activation authority. Focused tests reject changed pair ground truth, unresolved execution, unavailable roadmap resolution, unbound approval resolution, missing category coverage, incomplete review accounting, overstated human approval, mismatched failure bindings, and altered discovery-probe text.

The paired search suites use the existing benchmark command. Reports remain owner-only observations and exclude query text and paths.

## Consequences

Lervo can inspect realistic Korean-framed repository retrieval without claiming cross-lingual understanding, and review conversational intent, context, authority, and no-guess behavior without changing search contracts or evidence levels. The initial provider-neutral deterministic runner evaluates all six declared verdict groups without provider adapters or search-engine changes. A complete agent pre-review and failure-candidate bundle expose omissions and unresolved choices, but human review of exact production-like cases remains necessary before the suite can establish production quality. ADR-0225 keeps the existing hybrid candidate inactive and requires a revised, explicitly cross-language mechanism rather than fixture-specific tuning.

See the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md), [local hybrid search decision](0217-local-hybrid-search-and-reviewed-relation-context.md), [cross-language candidate revision](0225-revise-local-hybrid-for-cross-language-recall.md), and [initial Korean-framed retrieval observation](../../evidence/search/korean-repository-retrieval-v1.md).
