# Discord behavior and execution settings

- [Example behavior](execution/behavior.md): intent resolution, execution routing, conversation continuity, and failure handling.
- [Participants and execution settings](execution/settings.md): identity bindings, organization validation, provider settings, response limits, and command completion requirements.

Optional `repositorySignals` maps exact canonical repository event types to subscribed proactive signal codes. It requires `policy.mode: proactive`, `system` in `respondTo`, and every mapped code in `signalCodes`. Signal messages never copy source event payloads; the selected agent resolves current information through managed repository retrieval.

Optional `deliberation` binds exact human principals and permissions to the durable conversation queue. `cliExecutable` must be an executable Lervo CLI matching the installed Node release. Topics cross the process boundary on stdin, and the queue-assigned identity must match the managed result. Start with `/lervo deliberate start <policy-id> -- <topic>`, inspect with `/lervo deliberate status <deliberation-id>`, and resume only an authoritatively reconciled interruption.
