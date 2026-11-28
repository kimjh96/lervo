# Explicit provider probe

`lervo knowledge convergence provider-probe --provider <codex|claude> [--json]` opens writable storage, invokes the runtime availability probe with every repository root the host registry and Node fleet list, and prints the result as JSON. A resumed probe forgets the provider's recorded failures in the host cache and in each listed repository's admission projection; [Provider pauses and probes](../events-and-status/provider-pauses-and-probes.md) defines the scope. It returns zero when `result.resumed` is truthy and one otherwise; it does not require equality to `true`.

The catch path interpolates `error.code`, using nullish coalescing to fall back to `knowledge_provider_probe_failed`, without runtime validation of the code's type, length, or syntax. After storage opens, finally attempts closure.

The wrapper alone provides no evidence of a successful installed provider journey.
