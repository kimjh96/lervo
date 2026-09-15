# ADR-0415: Natural deliberation and consistent failure evidence

- Status: accepted
- Decision date: 2026-09-16

## Context

Installed deliberation had three operational defects. Discord could enter it only through exact command syntax, subscribed workers still performed an idle 30-second recovery scan, and a valid terminal failure with zero published artifacts was diagnosed as inconsistent. Publication-failed artifacts remained recoverable in CAS but the primary artifact count did not explain that they were deliberately quarantined.

The whole deliberation also has several managed provider and writing-evaluation turns. A single 15-minute process deadline could therefore kill healthy bounded work even while its lease heartbeat remained current.

## Decision

A Discord deployment may set one `defaultPolicyId`. When set, the surface advertises `deliberation_start` to the existing managed semantic turn resolver. An explicit human request to debate or independently challenge a topic supplies only that bounded topic; the deployment supplies the policy. The effect enters the same platform-neutral deliberation port, principal authorization, durable queue, assigned identity, managed executor, verification, and reconciliation path as `/lervo deliberate start`. Command syntax remains available for exact policy selection, status, and resume. When no default is configured, natural-language deliberation is unavailable rather than guessed.

Subscribed change loops now remain unscheduled when they have neither a durable change hint nor an exact work deadline. They still scan once at startup, wake immediately for committed in-process changes, wake at lease or reconciliation deadlines, and use the configured retry interval after failure. This removes steady-state queue polling without weakening startup recovery or deadline handling.

A completed `failed` outcome does not require a published artifact. `artifactCount` remains the compatibility name for published artifacts, while inspection also exposes `publishedArtifactCount`, `quarantinedArtifactCount`, and the existing bounded `failedPublications` recovery records. Successful and no-consensus outcomes continue to require published history. Discord terminal notifications state the published count and direct failed runs to the separate quarantine inspection.

The default whole-process ceiling increases from 15 minutes to 60 minutes. Per-run managed deadlines, queue lease heartbeats, bounded rounds, bounded publication repair, output limits, and uncertain-outcome reconciliation remain the primary safety controls; deployments may set a smaller explicit ceiling when appropriate.

## Consequences

Users can request deliberation naturally without creating a Discord-specific execution path. Idle subscribed workers do no periodic work. Failed histories remain internally valid and diagnostic output no longer conflates publication with recoverability. Existing command clients and queue records continue to read `artifactCount` as the published count.

Formal deliberation remains intentionally more expensive than ordinary multi-agent conversation. Autonomous agents may participate in normal conversation under their role relevance and authority policies, but this change does not grant an agent a human deliberation principal or let a model choose an unconfigured policy.

## References

- [Installed proactive signals and managed conversation deliberation](0392-installed-proactive-signals-and-deliberation.md)
- [Deliberation publication failure](../../../specifications/execution/events-and-privacy/terminal-observations/deliberation-publication-failure.md)
- [Governed agent memory and autonomous participation](agent-organization/0411-governed-agent-memory-and-autonomous-participation.md)
