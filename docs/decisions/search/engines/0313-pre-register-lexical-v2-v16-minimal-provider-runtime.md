# ADR-0313: Pre-register lexical-v2 v16 minimal provider runtime

Status: `accepted`  
Date: 2026-08-31

## Context

V15 completed all matched calls but rejected activation. Codex achieved 36/36 observations and 12/12 cases, 100% recall, 98.61% precision, zero errors/tools/contracts, 80.72% of baseline tokens, and 30.16% of baseline bytes. Its end-to-end duration was 99.48%, failing the unchanged 95% gate. Claude achieved 30/36, 95.83% recall, 86.11% precision, 51.65% of baseline tokens, and 96.59% duration. Its nine provider errors were intermediate `structured_output_carrier_failed` results followed by successful native structured outputs; fuzzy merge still cited only one of two supplied authorities.

Both adapters start the full coding-agent runtime for a bounded, no-tool evidence answer. Their large provider-specific default system prompts advertise prohibited capabilities. This fixed startup and prompt cost dominates the smaller candidate evidence, preventing token reductions from producing stable latency reductions. Both provider SDKs support an explicit replacement base/system instruction.

## Decision

Create `lv2bench_provider_comparison.v16`. Keep every case, expected path, arm, repetition, model, low effort setting, native result schema, evidence delivery rule, maximum invocation count, and acceptance threshold unchanged.

1. Add this provider-neutral base instruction: “You are a bounded evidence-answering model. Follow the injected governance protocol and task-evidence documents. Do not call tools or use outside knowledge.” Bind its digest `sha256:9c4d25f88dec9a8fdfbf0a30ab01573a88a07a4132014d3bb80b1f939bb711ef` in the suite. Pass it behind the adapters as Codex `baseInstructions` and Claude Agent SDK `systemPrompt`. Both arms and providers receive identical text.
2. Keep ordinary tool exposure empty where supported and retain normalized zero-tool/zero-command gates. Minimal instructions authorize no new transport, tool, credential, or external source.
3. Treat a failed `StructuredOutput` carrier as a pending native schema retry, not an immediate provider error. If the turn later succeeds with `structured_output`, consume the recovered framing. If structured output remains absent or the turn fails or exhausts retries, preserve the failure through the existing provider result/turn failure contract. Ordinary tools, incorrect carrier names, and unbound results remain observable failures.
4. Revise the common answer protocol: a question combining an operational permission boundary with conflict-resolution or rationale evidence requires a source for each distinct part, up to the unchanged two-path maximum. This changes query semantics, not case IDs or expected-path rules.

Run the provider-free gate and adapter differential tests first. Then run Codex and Claude sequentially without retries or replacements. V15 reports remain immutable at SHA-256 `ab84bf3978e1639b1a0e037f28b8d4997145c4c31dfd889c45da1b53d22a1154` for Codex and `6efb0b75662df8264fd6122df1e52eba09098d97af8140cdbb8fcc28a472e73f` for Claude.

## State, privacy, and failure meaning

The base instruction is a versioned public constant containing no repository or user data. Adapter options carry it only to the provider-native session initializer. `StructuredOutput` retry count remains internal transport state and creates no success, use, or tool event. A final successful result is eligible only when the existing closed schema captures `structured_output`; exhausted or terminal failures remain activation-ineligible.

## Activation gates

Each provider independently requires case non-regression, recall/precision non-inferiority, at least 27/36 candidate passes, nine cases passing every repetition, at least 85% recall and 50% precision, complete usage and native structured output, zero provider/contract/tool/command failures, a token ratio no greater than 90%, a duration ratio no greater than 95%, and injected bytes no greater than 70%. Local English and Korean quality/cost gates remain unchanged.

## Consequences

This change targets fixed runtime overhead without lowering the speed gate. Provider behavior remains behind adapters, and external engines can reuse the bounded evidence and result contracts. If either provider fails, lexical-v1 remains operational and v16 cannot activate.

## Verification

- Test exact base-instruction forwarding through Codex app-server and Claude SDK options.
- Test Claude recovered-carrier, exhausted-carrier, wrong-name, ordinary-tool, and unbound-result behavior.
- Run common adapter parity and no-tool isolation tests.
- Run provider-free v16 expected-path, document, byte, schema, and digest checks.
- Produce fresh sequential Codex and Claude v16 reports.
- Complete repository quality, type, test, documentation, knowledge, release-artifact, and base-bound checks.

## References

- [V15 authority-preserving confirmation](0312-pre-register-lexical-v2-v15-authority-preserving-confirmation.md)
- [V12 activation gates](0308-pre-register-lexical-v2-pipeline-activation-gates.md)
