# Change-driven Node and repository work

Status: active
As of: 2026-09-11

## Notification and authority

Notifications mean only that durable state should be checked. Repository parity, event-chain integrity, command authorization, current conversation policy, and worker leases retain their existing verification boundaries. Local execution requires neither a Hub nor a peer connection.

## Contracts and validation

- [Repository replica subscriptions, snapshots, and readiness](node-change-driven-work/repository-replicas.md)
- [Conversation queues and bounded scheduler](node-change-driven-work/conversation-scheduling.md)
- [Remaining timers and acceptance](node-change-driven-work/validation.md)
