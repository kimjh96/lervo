# Headless application contract

The versioned boundary for replaceable products must include:

- Typed commands for agent, assignment, approval, handoff, retry, suspend, and resume.
- Bounded queries for workstream, graph, blocker, verification, evidence, and improvement.
- Subscriptions to privacy-bounded lifecycle events.
- Content-bound plan/apply, idempotency, compatibility, and authorization coordinates.
- Provider, execution-target, capability, search, and surface adapter ports.
- Common contract tests preventing adapters from inventing authority or telemetry.

The CLI and minimal local reference client must use the same public contracts as external applications. No external surface may require internal database access, become necessary for local execution, or silently translate presentation state into repository authority.
