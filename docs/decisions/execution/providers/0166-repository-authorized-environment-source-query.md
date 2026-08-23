# ADR-0166: Repository-Authorized, Provider-Neutral Environment Sources

- Status: accepted
- Decision date: 2026-08-22

## Context

Agents should reuse how to rediscover current device/service endpoints, not stale conversational values or one vendor's names. Authority belongs to each repository project, and discovery itself must not grant permanent registration or upload provider identities.

## Decision

@lervo/environment owns neutral source manifests, admission, observations, logical targets, and resolution; core contracts contain no Tailscale-specific field or executable.

Tracked .lervo/environment-sources/<sourceId>.source.yaml authorizes adapter, scope, capabilities, maximum validity, sharing, and bounded configuration. Only repository policy or human review changes it. Optional .lervo/environment-admission.yaml deterministically returns auto_register, review_required, or deny; absent/unmatched policy defaults to review_required, and no auto-registration writer exists yet.

Adapters return only available/unavailable, generic subject labels, capabilities, endpoints, and verification. Core rejects excess capability and computes validUntil. Atomic owner-only .lervo/state/environment observations are rebuildable local state and unusable after expiry.

Tracked targets name a repository role, required capability, selectors, and source preference—not an OS or provider. Resolution uses only fresh verified candidates and treats tied candidates as ambiguous. Device labels never imply WSL, container, service, Node, SSH, or host-key relationships.

lervo environment query --source updates one normalized observation; --target freshly queries eligible sources then resolves; --adapter ... --ephemeral writes nothing; resolve --target reads fresh stored observations only.

The first replaceable adapter runs bounded tailscale status --json without a shell and discards accounts, node/map/user IDs, and raw JSON. It normalizes only DNS/IP/OS/online with hashed subject IDs.

Tracked configuration excludes secrets. Observations cap subjects, endpoints, and labels. Failures are bounded source/adapter/observation/unresolved/ambiguous codes and never claim connection or credential possession.

## Consequences

Discovery, repository admission, runtime observation, and target resolution are distinct. Fixtures cover neutral adapters, capability denial, expiry/ties/preference, YAML safety, owner-only storage, Tailscale redaction, bounded failures, and ephemeral non-mutation. Automatic admission patches, managed preflight, verified runtime relationships, Hub sharing, and cross-Lervo references remain separate.
