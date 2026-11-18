# Change-driven Node and repository work

Status: active
As of: 2026-09-16

## Notification and authority

Notifications only signal that durable state should be checked. Repository parity, event-chain integrity, command authorization, current conversation policy, and worker leases retain their existing verification boundaries. Local execution requires neither a Hub nor a peer connection.

## Contracts and validation

- [Repository replica subscriptions, snapshots, and readiness](node-change-driven-work/repository-replicas.md)
- [Conversation queue scheduling](node-change-driven-work/conversation-scheduling.md)
- [Remaining timers and acceptance](node-change-driven-work/validation.md)

ADR-0414 removes the remaining repository batch barrier, replaces short owner-admission polling with lease notifications, and narrows supervision consistency to owned source coordinates. Recovery, integrity, protocol, lease, and deadline timers remain explicit safety controls, not ordinary work discovery.
