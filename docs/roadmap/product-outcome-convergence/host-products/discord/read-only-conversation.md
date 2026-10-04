# Natural-language Discord conversation routing

Part of [Discord remote continuation](../discord.md).

State: `delivery required`. Installed read turns run on the guild; post-deployment human-turn p95 acceptance remains open.

## Purpose

Mapped participants send ordinary messages in the configured Discord conversation, with or without a bot mention. One managed, read-only, surface-neutral turn resolves participation, informational answers, write-capable continuation, scoped platform actions, or clarification. Informational and unclear requests remain read-only. Only sufficiently confident human mutation requests reach an explicitly authorized effect.

## Details

- [Design, configuration, and validation](read-only-conversation/contract.md)
- [Recovery, acceptance, and latency evidence](read-only-conversation/recovery.md)

## References

- [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [ADR-0388](../../../../decisions/coordination/conversations/0388-realtime-conversation-effects-and-lifecycle.md)
- [ADR-0389](../../../../decisions/coordination/conversations/0389-single-managed-conversation-turn.md)
