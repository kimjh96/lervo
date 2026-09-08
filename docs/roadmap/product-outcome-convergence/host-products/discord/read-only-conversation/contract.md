# Conversation routing contract

## Design

Conversation participation, the managed turn, Hub continuation, Discord administration, and platform delivery remain separate. The read-only role denies filesystem writes, shell execution, network access, external messages, deployment, and data mutation.

Natural replies follow a multilingual chat contract and require product-default search, repository-knowledge, relation, and managed context evidence. The realtime profile retains deterministic publication evidence without another synchronous model; deployments may opt into independent semantic evaluation.

Participant bindings support humans and agents. Agent responses are opt-in and retain role identity, automation-depth limits, and hourly rate limits. The event boundary can later support managed deliberation without autonomous reply loops or agent-authored repository mutation.

## Configuration

The response path injects the exact current workstream and selected repository context so routine status questions need no provider-tool rediscovery. The combined turn, optional independent publication evaluation, and repository command execution have separate provider/model settings.

Bounded reasoning effort and a fail-closed timeout are configurable for the managed turn. Legacy `routing.intent` remains accepted only for custom responder composition. `administration.allowedActions` independently grants bounded Discord effects.

## Validation

Focused tests prove:

- Ordinary messages with and without mentions enter the same semantic router.
- Intent, per-agent participation, effect, and read reply are produced by one managed provider run.
- CLI and conversation execution share qualified search and repository-context preparation.
- Bounded prior turns are supplied.
- Read and continuation delegates remain separate.
- Installed-runtime participation no longer requires a mention.
- Persisted response-generation failures are retried and delivered without another Discord message.
- Semantic publication evaluation supplies an exact structured-output schema through either provider adapter.
- Active inbox leases renew, identical response attempts share one generation, and typing remains active across scheduled retry.
- A natural-language nickname request uses the explicitly allowlisted current-member Discord action rather than repository continuation.
- Queue and completion prose hides internal execution coordinates while retaining them in durable evidence.

Gateway control traffic remains responsive during long provider work. Subsequent messages retain order. Response-only typing starts before semantic evaluation for a human turn and remains bounded, best-effort, and continuous across a scheduled retry.
