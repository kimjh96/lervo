# Discord agent deployments

A Node may supervise one to eight Discord agent deployments. A deployment speaks through either its Gateway bot user or one incoming webhook per configured channel. Webhook-backed agents may share one exact Discord application and bot credential while each current runtime owns its Gateway connection lifecycle. They retain distinct webhook IDs, owner-only webhook credentials, hired-agent and role bindings, provider and model routing, storage, response ownership, and delivery adapters.

The collection-level supervisor owns only aggregate readiness, failure, result delivery, and shutdown. It reports ready only after every Gateway is ready, fails the Node if any member runtime fails, and attempts to close every member.

Shared-channel peer aliases map each external bot or webhook author to exactly one workforce participant without merging credentials, runtime state, or provider policy. Bot users also retain their native mention alias. Webhooks are addressed through Lervo participant or role routing because they are not Discord guild members. Compatible single-bot configuration uses the same per-deployment runtime boundary.

## Turn ownership and identity evidence

The platform-neutral turn-ownership contract uses the common source-event hash and conversation roster before semantic relevance or provider work. Exact participant mentions address those participants; role mentions select one member per role; unaddressed messages select one eligible participant. A non-owner records `turn_not_owned` without starting typing or claiming semantic irrelevance.

Hired-agent participants retain the agent ID, exact role version, contract hash, and profile hash in platform bindings and normalized message history. Each deployment keeps its own durable interaction store and supplies bounded recent turns only to that agent's responder. Role contracts, provider sessions, bot credentials, and conversation history remain independently replaceable.

On deployment restart, an exact external principal still bound to the same hired-agent ID may refresh its current role ID, version, contract hash, and profile hash. A different agent ID or participant ID fails closed. This projection refresh never rewrites prior normalized messages: historical turns retain the role snapshot recorded when each event was created.

## Response failures

Response errors pass through a provider-neutral classifier before persistence. Retryable work has an explicit attempt bound. Exhausted or non-retryable work produces a fixed, deterministically verified terminal status instead of remaining silent.
