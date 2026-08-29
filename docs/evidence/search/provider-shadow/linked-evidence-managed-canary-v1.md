# Managed-context canary v1 stop report

Status: `failed_stopped_without_retry`
Date: 2026-08-29

## Result

Managed-context canary v1 stopped during its first Codex selection turn. The adapter emitted one forbidden command-execution signal, so the common boundary returned `canary_selection_unavailable` before selection completed. No ordinary task call or Claude call started.

| Measure | Observed result |
| --- | ---: |
| Prepared task runs | 16 |
| Completed task runs | 0 |
| Provider calls | 1 of at most 32 |
| Codex calls | 1 selection, 0 task |
| Claude calls | 0 selection, 0 task |
| Selection duration before stop | 12.044 s |
| Candidate sources | 6 |
| Provider-visible source bytes | 42,333 |
| Selected / loaded / injected / referenced | 0 / 0 / 0 / 0 |
| Provider-reported usage | Unavailable |
| Source repository change | None |
| Retries / repairs / fallbacks / replacements | 0 / 0 / 0 / 0 |

The exact prepared manifest digest is `sha256:79e872f22eb072e0e75e8292ccff386f683b8979b61a016f49128e5cb60c6182`. The owner-only failure record `lcanary_0c3d6b1574a0807612597531` has file digest `sha256:19f96b1359ce5976fa03be50e824682274fd126d1828a950505243c52218b60a`. The source repository status digest was `sha256:47b29ad14d5304732bf11ca97060af58528351e3d32890b76c910583c74d2fc1` before and after the attempt.

## Measurement interpretation

V1 has no valid managed-task sample. Recall, precision, answer accuracy, task duration, task tokens, context byte reduction, and cross-provider comparison are unmeasured. The passed V18 selection-only scores must not be reused as managed-task results.

The stop left 31 authorized calls unmade, or 96.875% of the call ceiling. This measures fail-fast budget preservation only, not evidence that the managed-context candidate is faster or cheaper.

For historical context, V18 selection-only evidence remains valid: Codex and Claude each had 100% recall, with mean precision of 93.75% and 76.04%, respectively. Those measurements neither repair nor override this execution-boundary failure.

## Failure meaning

The Codex read-only selection session retained and exercised command capability. This does not mean Codex selected incorrect evidence, Claude failed, or managed task answers were inaccurate; none of those outcomes was observed.

The provider-neutral preflight requires selection sessions to report tool calls, command execution, and file changes as unsupported before candidate injection or a model turn. Provider-free tests show that the current Codex adapter stops with zero selection turns and that an empty-tool Claude session completes one structured selection turn. These are contract tests, not new model measurements.

Codex app-server 0.150.1 exposes no thread- or turn-level no-tool control in its generated protocol schema, so the current Codex transport remains ineligible. The next eligible paired experiment requires a capable Codex transport, a new immutable checkpoint, and fresh exact authorization. V1 is not resumable.

## References

- [ADR-0279](../../../decisions/search/activation/provider-shadow-structured/0279-stop-managed-context-canary-v1-on-command-signal.md)
- [Prepared checkpoint](../../../decisions/search/activation/provider-shadow-structured/0278-prepare-exact-managed-context-canary-checkpoint.md)
- [V18 selection evidence](linked-evidence-provider-shadow-pilot-v18.md)
