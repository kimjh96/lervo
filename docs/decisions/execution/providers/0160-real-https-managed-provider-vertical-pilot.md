# ADR-0160: Real HTTPS Managed Provider Vertical Pilot

- Status: accepted
- Decision date: 2026-08-22

## Context

Passing isolated contracts does not prove the real Hub, Node, TLS, authoring, approval, policy-first polling, installed provider factories, verification, and acknowledgement compose successfully. Such credentialed network work must remain opt-in, not default CI.

## Decision

pnpm pilot:managed-provider:https requires built lervo-hub/lervo-node, openssl, and authenticated Codex and Claude environments. In a new owner-only temporary tree it creates an isolated project, provider-specific suites, configs, Ed25519 keys, review secret, bearer snapshot, and self-signed TLS certificate.

It starts the real TLS-1.3 Hub with explicit CA trust, authors one Codex and one Claude command through HTTP, issues signed policy and command-bound approvals, then starts the real Node with production HTTPS transports and installed managed-provider host—never fixture transports or injected fake executors.

Each provider must modify its own approved path. Success requires local file.changed, passed verification, run.completed, and two completed Hub acknowledgements. Output is limited to provider, run ID, relative path, verification status, transport, and minimum TLS version. It excludes requests, prompts, responses, secrets, signatures, and absolute paths. Temporary state is removed unless a failed run explicitly sets LERVO_KEEP_REAL_PILOT=1.

## Consequences

A real 2026-08-22 run completed both providers through TLS 1.3 and durable acknowledgement. The pilot is excluded from pnpm check/CI because it depends on external providers and credentials, performs no rollback of partial changes, and proves neither production PKI, daemon supervision, rotation, nor multi-host operation.
