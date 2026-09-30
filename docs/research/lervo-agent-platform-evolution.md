# Lervo agent platform and evolution research

Status: `accepted input`

As of: 2026-09-03

## Purpose and scope

Define how Lervo supports Paperclip-like operating products, Buzz-like collaboration products, Prime- or Hermes-like execution agents, governed loops, and execution graphs without duplicating product interfaces or coupling core contracts to one generation of AI models or techniques.

This research does not authorize runtime behavior, reopen completed v0 scope, or require a named external product dependency.

[ADR-0417](../decisions/execution/applications/0417-own-discord-visible-reference-product.md) assigns Lervo ownership of a bounded Discord-visible reference product and a future first-party surface. General-purpose social or media products remain excluded. Repository-work channels, canvases, workflows, files, media, search, activity, and steering are accepted outcomes through the shared headless boundary.

## Platform conclusion

Lervo is a headless, local-first control plane and extension platform for durable, governed, verifiable repository-agent work. It owns work, authority, evidence, verification, knowledge, and recovery semantics. Host products own audiences, interaction models, and presentation without creating another source of repository truth.

```text
operating and collaboration products
  -> versioned application adapters and read models
  -> Lervo work, policy, evidence, knowledge, loop, and graph contracts
  -> versioned provider and execution-target adapters
  -> interchangeable agents, models, tools, and workspaces
```

## Research topics

- [Product boundaries, graph foundations, and application contracts](lervo-agent-platform-evolution/platform-contracts.md)
- [Evolution, refinement sequence, and success conditions](lervo-agent-platform-evolution/evolution.md)

## Related research and authority

[Product positioning and verified improvement research](lervo-product-positioning-and-verified-improvement.md) owns the broader comparison and terminology. [System architecture](../architecture/system.md), [product vision](../product/vision.md), [execution specification](../specifications/execution.md), and [repository knowledge specification](../specs/repository-knowledge-compilation.md) remain authoritative for implemented behavior.
