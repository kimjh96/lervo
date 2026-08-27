# Lervo v0 Acceptance Gates

Status: `complete`
As of: 2026-08-27

- Local `init -> migrate knowledge -> apply -> lint -> query -> managed run -> verification` succeeds without a Hub.
- User documents remain byte-safe without exact approval.
- Normalization preserves section coverage, managed blocks, code and link coordinates, skill identity, and skill-resource lifecycle; Shiflo is not merely relocated legacy content.
- Codex and Claude pass shared contracts.
- A clean clone or another installation reproduces tracked knowledge.
- Direct Codex and Claude prompts invoke the repository-local hook or fail closed without a globally discoverable `lervo`; installation reports the provider-native trust action, readiness remains incomplete until contract-v2 invocation evidence exists, and sessions remain unmanaged.
- Generated documents are English, bounded, and idempotent.
- No dormant documentation or feature directory is created.
- Documentation lifecycle, typecheck, targeted tests, build, and applicable distribution checks pass.
- Natural-language capability selection remains deterministic and evidence-bound; deleting `.lervo/state` preserves durable data and permits projection reconstruction.
- An agent can upgrade an initialized repository through `lervo upgrade`; same-version rebuilt Node payloads reconcile by hash, while CLI acquisition and non-Lervo authority remain explicit.
- CLI, Hub, and Node release validation uses the supported runtime boundary rather than the checker's built-in inventory; Node 22.13 packed consumers run with empty stderr, and temporary deployment works across Windows volumes.

## References

- [Lervo v0 roadmap](v0.md)
- [System architecture](../architecture/system.md)
- [Execution specification](../specifications/execution.md)
