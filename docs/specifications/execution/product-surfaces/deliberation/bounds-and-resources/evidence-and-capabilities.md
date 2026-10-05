# Deliberation evidence and capabilities

## Immutable repository evidence

Managed deliberation resolves repository knowledge once, before the first provider starts. It selects bounded current topic-ranked publications, rereads each source under the repository file boundary, verifies its query-returned content hash, and materializes an immutable workspace copy and manifest. The manifest binds query, source snapshot, impact report, source path, concept, and exact source hash.

No current result, changed source, oversized source, invalid bundle, or failed copy records `deliberation_evidence_unavailable` and a terminal failed deliberation with zero provider calls.

Every stakeholder and verifier turn receives the same manifest and exact copies through managed context rules. Writing evaluators receive only their evaluation request and writing policy. Resume restores exact generated evidence bytes from the checkpoint without rerunning retrieval. Selected, loaded, injected, and referenced evidence remain separately observable and are never inferred from the bundle alone.

## Provider capability boundary

Managed deliberation provider turns consume only the exact-hash evidence bundle and prior writing-gated publications injected by Lervo. The application disables provider tools where the native adapter supports that boundary and independently configures every deliberation child run with zero allowed tool calls and zero allowed command executions.

The first observed tool or command event is retained as normal provider telemetry, aborts the active provider session, and records `run.failed` with `provider_tool_limit_exceeded` or `provider_command_limit_exceeded`. These existing failure events require normal run, session, phase, code, retryability, and causal coordinates. They add no prompt, command body, output, document body, credential, or native provider payload. Neither failure is retryable within the deliberation: repeating the same unconstrained behavior would spend the bound again.
