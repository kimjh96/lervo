# Lexical-v2 activation confirmation v12

Status: `rejected for activation`  
Observed: 2026-08-31

## Question

Does frozen lexical-v2 build `sebuild_f80913229c9023d3d74ddc9a`, combined with bounded section evidence, satisfy every preregistered local, Codex, and Claude activation gate without a threshold or post-observation implementation change?

No. The candidate materially outperformed lexical-v1 on most measurements, but the frozen Codex report failed case-level non-regression and the 5% duration-reduction gate. The frozen Claude report failed the no-tool and provider-contract gates for both arms. Operational retrieval remains `lexical-v1`; lexical-v2 remains an inert evaluation candidate.

## Frozen coordinates

- Suite: `lv2bench_provider_comparison.v12`, digest `sha256:01ab1ee72a8022b7ddee5c80d651c8ae2e5e673ccf08ab913aa7c29b56ad3f08`
- Ranker: `sha256:395bbc7a9622f034bfa50b480dedfc0d2c20745dcda1dbe520141bcab1a0d017`
- Section selector: `sha256:0ac621849f7c8e2e2f930bbdadbf1f003e6028e32c37598c3a5b9e85248b1c57`
- Evidence pipeline: `sha256:3d0de02514005a3f3a1c3f4f87bfb81633d05968c12bbcd3b8ebf7ce9dbede92`
- Runner: `sha256:490252fdb20329acb704243eb63df588a2fa91e9eddd771e6d3391f3046bd126`
- Response contract: `sha256:8d5decd7460663fbe33b19e4a4145eb257498109757ffbeb69647baf7ba6b5cb`
- Native structured-output schema: `sha256:67232b9de05c38023c5a79cdb6438dbfe3b2965ce4e77294c6d6fca0eae2673e`

The confirmation retained the original eight provider cases and added four previously uncalled holdouts, one per task type. Each provider ran three repetitions of both arms: 72 independent invocations without retries. Both arms used the same model, native schema, versioned response protocol, low reasoning effort, and acceptance thresholds. No ranker, selector, pipeline, protocol, expected path, query, or threshold changed after the first v12 provider call.

## Provider-free and local evidence

The provider-free v12 envelope covered every expected path, returned at most four candidate documents, and reduced candidate injected bytes to 37.65% of baseline.

The augmented local suites preserved all twenty original cases and added four public capability cases each.

| Suite | lexical-v1 success | lexical-v2 success | Recall@10 | MRR | Build p50 ratio | Query p50 ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| English, `spreport_60050d56ea252fc1843bdc1a` | 19/24 | 23/24 | 70.14% -> 90.28% | 40.81% -> 61.37% | 2.29x | 0.81x |
| Korean, `spreport_a592322985b508179a67922f` | 18/24 | 22/24 | 68.75% -> 85.42% | 53.82% -> 64.44% | 2.31x | 0.68x |

Every task type had at least one candidate-only success and no baseline-only successes. These reports pass the preserved local quality contract. A final verification retained those quality results but reported Korean build p95 at 3.05 times baseline, exceeding the unchanged 3.00-times bound (`spreport_3894a24883dce5d074682e02`). The English rerun remained within the bound (`spreport_9a7cf13df0c3a3a6a4d7e0e1`). This build-tail variability is another activation blocker and cannot be discarded in favor of the earlier run.

## Codex confirmation

Codex `gpt-5.6-sol` completed all 72 invocations with complete usage, native structured output, and zero provider, contract, tool, or command failures.

| Measure | lexical-v1 | lexical-v2 | Gate result |
| --- | ---: | ---: | --- |
| Passed observations | 24/36 | 31/36 | absolute floor passed |
| Cases passing every repetition | 8/12 | 10/12 | absolute floor passed |
| Expected-path recall | 66.67% | 88.89% | passed |
| Returned-path precision | 66.67% | 87.50% | passed |
| Reported total tokens | 923,285 | 783,968 | 84.91%; passed |
| Total duration | 365.308 s | 354.430 s | 97.02%; **failed** |
| Injected evidence bytes | 832,854 | 313,575 | 37.65%; passed |

The previously uncalled knowledge-lifecycle status case passed 3/3 for baseline and 1/3 for the candidate, failing the required per-case non-regression gate. The candidate sometimes cited a related roadmap instead of the directly answering lifecycle specification; aggregate improvements cannot conceal that regression.

## Claude confirmation

Claude `opus` completed all 72 invocations with complete usage, no provider errors, and native structured output.

| Measure | lexical-v1 | lexical-v2 | Gate result |
| --- | ---: | ---: | --- |
| Expected-path recall | 66.67% | 86.11% | passed |
| Returned-path precision | 66.67% | 84.72% | passed |
| Reported total tokens | 596,778 | 352,154 | 59.01%; passed |
| Total duration | 400.866 s | 373.718 s | 93.23%; passed |
| Injected evidence bytes | 832,854 | 313,575 | 37.65%; passed |
| Contract-valid observations | 0/36 | 0/36 | **failed** |

Each arm reported one completed tool call per observation despite an empty requested tool set. The native structured-output path therefore remained observable as `provider.tool.called` at the common adapter event boundary. The harness correctly applied the preregistered zero-tool rule symmetrically: all 72 observations failed tool isolation and the provider contract. Quality and efficiency measurements diagnose the candidate but are not activation-eligible. Reclassifying events after observation or rerunning with a modified harness would violate the frozen confirmation.

## Disposition

- Reject lexical-v2 activation and retain `lexical-v1` as the operational and rollback engine.
- Retain the lexical-v2 package, registered candidate, bounded evidence pipeline, suites, and provider adapters as evaluation infrastructure.
- Do not claim that v2 simultaneously passed speed, token, quality, accuracy, and cross-provider validity.
- Treat the fresh Korean build-p95 cost failure as terminal v12 evidence alongside the provider failures.
- Any future candidate must use a new preregistered suite revision, correct deterministic current-source selection for the knowledge-lifecycle holdout, meet the unchanged duration gate on fresh Codex observations, and define a provider-neutral distinction between native result-carrier activity and user-authorized tools before another Claude confirmation.
- Do not retry v12, post-filter observed events, lower a threshold, delete a regression case, or activate from the earlier eight-case v11 development pass.

## Related decisions

- [Pre-registered activation gates](../../../decisions/search/engines/0308-pre-register-lexical-v2-pipeline-activation-gates.md)
- [Final v12 disposition](../../../decisions/search/engines/0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md)
- [Extensible search architecture](../../../research/extensible-search-engine-architecture.md)
