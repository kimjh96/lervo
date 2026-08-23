# ADR-0166: Repository-Authorized, Provider-Neutral Environment Sources

- Status: accepted
- Decision date: 2026-08-22

## Context

Agents need a reusable way to rediscover current device and service endpoints without relying on stale conversational values or vendor-specific names. Each repository project owns the authority for discovery, which must not grant permanent registration or upload provider identities.

## Decision

`@lervo/environment` owns provider-neutral source manifests, admission, observations, logical targets, and resolution. Core contracts contain no Tailscale-specific field or executable.

Tracked `.lervo/environment-sources/<sourceId>.source.yaml` files authorize the adapter, scope, capabilities, maximum validity, sharing, and bounded configuration. Only repository policy or human review may change them.

Optional `.lervo/environment-admission.yaml` policy deterministically returns `auto_register`, `review_required`, or `deny`. Missing or unmatched policy defaults to `review_required`. No automatic registration writer exists yet.

Adapters return only availability, generic subject labels, capabilities, endpoints, and verification. Core rejects excess capabilities and computes `validUntil`. Atomic, owner-only observations under `.lervo/state/environment` are rebuildable local state and cannot be used after expiry.

Tracked targets identify a repository role, required capability, selectors, and source preference—not an operating system or provider. Resolution considers only fresh, verified candidates and treats ties as ambiguous. Device labels do not imply WSL, container, service, Node, SSH, or host-key relationships.

Command behavior is fixed:

- `lervo environment query --source` updates one normalized observation.
- `lervo environment query --target` freshly queries eligible sources and resolves the target.
- `lervo environment query --adapter ... --ephemeral` writes nothing.
- `lervo environment resolve --target` reads only fresh stored observations.

The first replaceable adapter executes bounded `tailscale status --json` without a shell. It discards accounts, node/map/user IDs, and raw JSON, retaining only normalized DNS, IP, OS, and online state with hashed subject IDs.

Tracked configuration excludes secrets. Observations cap subjects, endpoints, and labels. Failures use bounded source, adapter, observation, unresolved, or ambiguous codes and never claim connection or credential possession.

## Consequences

Discovery, repository admission, runtime observation, and target resolution remain distinct. Fixtures cover neutral adapters, capability denial, expiry, ties, preferences, YAML safety, owner-only storage, Tailscale redaction, bounded failures, and non-mutating ephemeral queries.

Automatic admission patches, managed preflight, verified runtime relationships, Hub sharing, and cross-Lervo references remain separate work.
