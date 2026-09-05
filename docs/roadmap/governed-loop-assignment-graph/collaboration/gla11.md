# GLA11: Production Slack assignment connector

One production Slack adapter implements the GLA8 boundary without granting the stock CLI external authority. An authorized host explicitly composes credential, destination, artifact, writing-permit, durable-state, and transport ports. Core and route plans retain only internal coordinates and hashes; native Slack identifiers and the bot token remain adapter-private.

The adapter persists `reserved` before the effect and `sending` immediately before one Web API call. Delivered, rejected, and unknown are exact terminal outcomes. Restarting with `sending` records unknown and never automatically replays.

The bounded SQLite store has explicit capacity failure and terminal-only retention. Shared conformance makes the safety behavior portable to future Discord, Teams, or other connectors.

## Acceptance

Focused tests must cover:

- Common connector conformance and stable private inspection.
- Descriptor, destination, credential, artifact, permit, and plan drift blocking.
- Durable reservation before effect, exact Slack receipt mapping, and rejected/unknown separation.
- Restart and same-outbound non-retry; contradictory evidence rejection.
- State capacity and terminal retention bounds.
- A full CLI host-injection dogfood journey using canonical handoff evidence, CAS artifact bytes, a full writing permit, SQLite state, and a controlled transport.

Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release intent. Live workspace delivery remains an external authorization exercise, not a local acceptance requirement.
