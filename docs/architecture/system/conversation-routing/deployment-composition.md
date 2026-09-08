# Conversation deployment composition

## Configuration and runtime ownership

Configuration parsing separates channel and participant bindings from routing and execution behavior. Runtime composition separately owns Hub continuation, provider construction, persistent history, immutable intent evidence, managed read execution, publication verification, retry scheduling, and deployment lifecycle.

New platforms and providers remain behind adapters. Role-backed deliberation can reuse identity and evidence contracts without expanding authority.

## Bot deployments

A Node may supervise one to eight Discord bot deployments. Each independently maintains its Discord application and owner-only credential, hired-agent and role binding, provider and model routing, storage, Gateway session, and delivery adapter.

The collection-level supervisor owns only aggregate readiness, failure, result delivery, and shutdown. It reports ready only after every Gateway is ready, fails the Node if any member runtime fails, and attempts to close every member.

Shared-channel peer aliases map each external bot author and mention to exactly one workforce participant without merging credentials, runtime state, or provider policy. Compatible single-bot configuration uses the same per-deployment runtime boundary.

The platform-neutral turn-ownership contract uses the common source-event hash and conversation roster before semantic relevance or provider work. Exact participant mentions address those participants; role mentions select one member per role; unaddressed messages select one eligible participant. A non-owner records `turn_not_owned` without starting typing or claiming semantic irrelevance. See [ADR-0391](../../../decisions/coordination/conversations/0391-deterministic-multi-agent-turn-ownership.md).

Hired-agent participants retain the agent ID, exact role version, contract hash, and profile hash in platform bindings and normalized message history. Each deployment keeps its own durable interaction store and supplies bounded recent turns only to that agent's responder. Role contracts, provider sessions, bot credentials, and conversation history remain independently replaceable.

Response errors pass through a provider-neutral classifier before persistence. Retryable work has an explicit attempt bound. Exhausted or non-retryable work produces a fixed, deterministically verified terminal status instead of remaining silent. See [ADR-0387](../../../decisions/coordination/conversations/0387-terminal-conversation-response-failures.md).

## Proactive signals and deliberation

An optional repository-event source maps allowlisted event types to existing `signal.raised` events without copying event payloads. Its owner-only cursor advances only after every mapped conversation dispatch completes. Participation, deterministic turn ownership, rate limits, managed retrieval, and publication remain unchanged.

Explicit deliberation commands enter the existing durable queue without a model classification round. The Node owns queue scheduling, while an executable adapter invokes the existing managed CLI lifecycle with the assigned identity and stdin-only topic. Discord transport, queue persistence, process execution, and provider work remain separate dependencies. See [ADR-0392](../../../decisions/coordination/conversations/0392-installed-proactive-signals-and-deliberation.md).
