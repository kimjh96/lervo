# Runtime boundaries and supervision

A Node may supervise one to eight Discord agent deployments. Each speaks through its Gateway bot user or one incoming webhook per configured channel. Webhook-backed agents may share one exact Discord application and bot credential, but each current runtime owns its Gateway connection lifecycle. They retain distinct webhook IDs, owner-only webhook credentials, hired-agent and role bindings, provider and model routing, storage, response ownership, and delivery adapters.

The collection-level supervisor owns only aggregate readiness, failure, result delivery, and shutdown. It reports ready only after every Gateway is ready, fails the Node if any member runtime fails, and attempts to close every member.

Shared-channel peer aliases map each external bot or webhook author to exactly one workforce participant without merging credentials, runtime state, or provider policy. Bot users retain their native mention alias. Webhooks use Lervo participant or role routing because they are not Discord guild members. Compatible single-bot configuration uses the same per-deployment runtime boundary.
