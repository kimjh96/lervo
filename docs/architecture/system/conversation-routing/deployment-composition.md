# Conversation deployment composition

## Configuration and runtime ownership

Configuration parsing separates channel and participant bindings from routing and execution behavior. Runtime composition separately owns Hub continuation, provider construction, persistent history, immutable intent evidence, managed read execution, publication verification, retry scheduling, and deployment lifecycle. New platforms and providers stay behind adapters; role-backed deliberation can reuse identity and evidence contracts without expanding authority.

## Bot deployments

A Node may supervise one to eight Discord bot deployments. Each independently maintains its Discord application and owner-only credential, hired-agent and role binding, provider/model routing, storage, Gateway session, and delivery adapter.

The collection-level supervisor owns only aggregate readiness, failure, result delivery, and shutdown. It reports ready only after every Gateway is ready, fails the Node if any member runtime fails, and attempts to close every member.

Shared-channel peer aliases map each external bot author and mention to one exact workforce participant without merging credentials, runtime state, or provider policy. Compatible single-bot configuration uses the same per-deployment runtime boundary.
