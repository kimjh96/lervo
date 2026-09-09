# Conversation deployment composition

Configuration parsing separates channel and participant bindings from routing and execution behavior. Runtime composition owns Hub continuation, provider construction, persistent history, immutable intent evidence, managed read execution, publication verification, retry scheduling, and deployment lifecycle.

New platforms and providers stay behind adapters. Role-backed deliberation can reuse identity and evidence contracts without expanding authority. Multiple agent deployments share a repository-scoped snapshot and query-index lifecycle. Bot-backed deployments retain independent Gateway credentials and lifecycle. Webhook-backed deployments may share one exact Gateway application and bot credential; each current runtime retains its connection lifecycle plus separate hired-agent identity, role context, provider sessions, history, webhook credentials, response ownership, and publication state.

## Deployment contracts

- [Bot deployments](deployment-composition/bot-deployments.md): runtime isolation, supervision, turn ownership, identity history, and response failures.
- [Proactive signals and deliberation](deployment-composition/proactive-signals-and-deliberation.md): repository-event dispatch and explicit deliberation execution.

## References

- [ADR-0391: Deterministic multi-agent turn ownership](../../../decisions/coordination/conversations/0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0387: Terminal conversation response failures](../../../decisions/coordination/conversations/0387-terminal-conversation-response-failures.md)
- [ADR-0392: Installed proactive signals and deliberation](../../../decisions/coordination/conversations/0392-installed-proactive-signals-and-deliberation.md)
