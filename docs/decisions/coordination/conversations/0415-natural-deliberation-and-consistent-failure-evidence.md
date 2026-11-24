# ADR-0415: Natural deliberation and consistent failure evidence

- Status: accepted
- Decision date: 2026-09-16
Amended by: [ADR-0460](../deliberation/0460-trigger-tiered-deliberation-at-decision-points.md)

## Context

Installed deliberation had three defects: Discord required exact command syntax, subscribed workers ran idle 30-second recovery scans, and valid terminal failures with zero published artifacts were diagnosed as inconsistent. Publication-failed artifacts remained recoverable in CAS, but the primary artifact count did not explain their deliberate quarantine.

Deliberation includes several managed provider and writing-evaluation turns. A single 15-minute process deadline could kill healthy bounded work despite a current lease heartbeat.

## Decision

A Discord deployment may configure one `defaultPolicyId`. When configured, the surface advertises `deliberation_start` to the existing managed semantic turn resolver. An explicit human request to debate or independently challenge a topic supplies only the bounded topic; the deployment supplies the policy. The effect follows the same platform-neutral deliberation port, principal authorization, durable queue, assigned identity, managed executor, verification, and reconciliation path as `/lervo deliberate start`. Commands remain available for exact policy selection, status, and resume. Without a configured default, natural-language deliberation is unavailable; no policy is guessed.

Subscribed change loops remain unscheduled without a durable change hint or exact work deadline. They scan once at startup, wake immediately for committed in-process changes, wake at lease or reconciliation deadlines, and use the configured retry interval after failure. This removes steady-state queue polling while preserving startup recovery and deadline handling.

A completed `failed` outcome requires no published artifact. `artifactCount` remains the compatibility name for published artifacts. Inspection also exposes `publishedArtifactCount`, `quarantinedArtifactCount`, and the existing bounded `failedPublications` recovery records. Successful and no-consensus outcomes still require published history. Discord terminal notifications state the published count and direct failed runs to separate quarantine inspection.

The default whole-process ceiling increases from 15 to 60 minutes. Per-run managed deadlines, queue lease heartbeats, bounded rounds, bounded publication repair, output limits, and uncertain-outcome reconciliation remain the primary safety controls. Deployments may explicitly configure a smaller ceiling.

## Consequences

Users can request deliberation naturally through the shared execution path. Idle subscribed workers perform no periodic work. Failed histories remain internally valid, and diagnostics distinguish publication from recoverability. Existing command clients and queue records continue to interpret `artifactCount` as the published count.

Formal deliberation remains intentionally more expensive than ordinary multi-agent conversation. Autonomous agents may join normal conversation under role relevance and authority policies. This change neither grants agents a human deliberation principal nor allows a model to choose an unconfigured policy.

## References

- [Installed proactive signals and managed conversation deliberation](0392-installed-proactive-signals-and-deliberation.md)
- [Deliberation publication failure](../../../specifications/execution/events-and-privacy/terminal-observations/deliberation-publication-failure.md)
- [Governed agent memory and autonomous participation](agent-organization/0411-governed-agent-memory-and-autonomous-participation.md)
