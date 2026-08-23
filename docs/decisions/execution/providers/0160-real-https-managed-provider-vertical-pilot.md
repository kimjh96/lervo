# ADR-0160: Real HTTPS Managed Provider Vertical Pilot

- Status: accepted
- Decision date: 2026-08-22

## Context

Passing isolated contracts does not prove that the real Hub, Node, TLS, authoring, approval, policy-first polling, installed provider factories, verification, and acknowledgement work together. Credentialed network testing must remain opt-in rather than part of default CI.

## Decision

`pnpm pilot:managed-provider:https` requires built `lervo-hub` and `lervo-node` packages, `openssl`, and authenticated Codex and Claude environments. It creates an isolated project in a new owner-only temporary tree, including provider-specific suites and configurations, Ed25519 keys, a review secret, a bearer snapshot, and a self-signed TLS certificate.

The pilot starts the real TLS 1.3 Hub with explicit CA trust, authors one Codex command and one Claude command over HTTP, issues signed policy and command-bound approvals, and starts the real Node with production HTTPS transports and the installed managed-provider host. It must never use fixture transports or injected fake executors.

Each provider must modify its own approved path. Success requires a local `file.changed` event, passed verification, `run.completed`, and two completed Hub acknowledgements.

Output is restricted to the provider, run ID, relative path, verification status, transport, and minimum TLS version. It excludes requests, prompts, responses, secrets, signatures, and absolute paths. Temporary state is deleted unless a failed run explicitly sets `LERVO_KEEP_REAL_PILOT=1`.

## Consequences

A real run on 2026-08-22 completed both providers through TLS 1.3 with durable acknowledgement.

The pilot remains outside `pnpm check` and CI because it depends on external providers and credentials and does not roll back partial changes. It does not prove production PKI, daemon supervision, rotation, or multi-host operation.
