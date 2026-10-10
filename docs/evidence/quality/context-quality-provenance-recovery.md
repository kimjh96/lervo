# Context-quality historical provenance recovery

Status: `audited_not_quality_qualified`
As of: 2026-10-10

The [earlier case audit](context-quality-priority4-evaluation.md) found four reviewed real-use families but no complete ADR-0501 labels or unseen held-out families. This follow-up verifies the retained local canonical history instead of substituting today's workstream for old context or asking the owner to manufacture a dataset.

## Recovered evidence

The [bounded audit coordinates](../../../benchmarks/context-quality/historical-provenance-v1.json) and [redacted result](context-quality-provenance-audit-v1.json) bind the unchanged reviewed suite, exact runtime/harness bytes, and a local event-chain head. The read-only storage owner verified complete event integrity. The audit inspected 2,853 relevant events beneath that head: 129 managed requests, 1,490 terminal preparations and 1,234 workstream snapshots. It resolved four exact historical event/CAS pairs:

| Revision | Recovered role                    | What it proves                                                           |
| -------- | --------------------------------- | ------------------------------------------------------------------------ |
| 282      | Approval packet                   | The pending approval ID and binding match the existing reviewed suite    |
| 283      | Post-approval checkpoint          | The exact subsequent checkpoint remains recoverable                      |
| 285      | Pre-measurement context candidate | The candidate historical objective/actions/references remain recoverable |
| 286      | Post-measurement checkpoint       | The exact subsequent measurement checkpoint remains recoverable          |

Every snapshot was verified against its CAS digest, schema, event ID/hash, workstream identity, revision, status and artifact coordinate. An imported copy does not replace the explicitly named historical event. Snapshot contents and private task text are excluded from this report.

These are historical candidates, not proof of which snapshot the old provider measurement actually consumed. The two historical report hashes declared by [the original measurement](../search/lexical-v2/lexical-v2-reviewed-real-use-projection-v1.md) are absent at their declared hashes in this local CAS. No terminal preparation matches the exact query digest of any of the four reviewed inputs. Consequently the three context-dependent cases still lack an exact original request-to-context binding. The original corpus coordinates are retained but its exact corpus is not reconstructed. Neither current workstream substitution nor expected-path-assisted query construction is allowed to fill these gaps.

## Population limitation

The inspected request events contain 1,224 distinct request digests. None has a body available at that digest in this local CAS. This is a bounded local-store finding, not a claim that the original inputs cannot exist elsewhere. A hash-only event is not a reproducible task body, and an agent-authored checkpoint objective is not a replacement for the user's original request. Even a retained request body would still need family classification, label review and tuning-exposure checks.

The known eligible population therefore remains four previously tuned real-use families, zero unseen held-out families and zero fully reviewed ADR-0501 label sets. At least 96 additional real families and the complete clause/section/negative/artifact labels are still needed for the planned 100-family population, with at least 30 percent unseen family-held-out. Old authored fixtures and repeated variants are not promoted into that population. The earlier human approval retains its retrieval-expected-path scope only.

## Reproduction and failure boundary

```bash
node scripts/evaluation/run-context-quality-provenance-audit.mjs
```

This command opens existing storage read-only. It does not restore a mutable current workstream, alter writer activation, create a provider turn or emit private bodies. It records exact protocol/harness/runtime hashes, stops its event scan at an observed head, and limits relevant events to 100,000. More than 32 exact request matches reports incomplete detailed evidence explicitly. A bound hit is not silently treated as complete. Missing declared artifacts remain unavailable; corrupt CAS, invalid snapshots, conflicting coordinates and mismatched reports reject the audit.

Nine focused tests cover privacy, exact request/context binding, missing evidence, CAS/schema/coordinate corruption, duplicate imports, false population promotion, scan/detail bounds and mismatched reports. This evaluation tooling changes no bundled runtime behavior and needs no additional runtime release intent. Existing implementation intents remain pending.

## Completion impact

This recovery proves that the four-case approval history and candidate snapshots were preserved. It does not qualify current retrieval, resource performance, task completion or installed behavior. The [latest performance candidate](context-quality-small-read-repair.md) remains rejected under its unchanged gates. Full completion still requires qualifying resource evidence, provenance-bound reviewed task families and repeated provider outcomes, then reader-first installed journeys, recovery and the seven-day/task-count cohort.

The next population step must obtain actual source inputs and reviewable labels from an authorized retained source or a newly consented prospective capture. Do not infer human review from model-generated annotations or an absence of observed errors. Do not weaken the original population, privacy or held-out requirements to close this audit.

A [subsequent read-only WSL inventory](context-quality-conversation-source-recovery.md) found 1,068 normalized human messages with 779 distinct exact bodies in integration-owned conversation artifact stores. This is a different source from the local repository CAS inspected here. Those messages still require context reconstruction, family classification, exposure assessment and human label review; the old full experiment reports remain unavailable at their declared hashes.
