# Explicit provider probe

`lervo knowledge convergence provider-probe --provider <codex|claude> [--json]` opens writable storage, invokes the runtime availability probe, and prints its result as JSON. The wrapper returns zero when `result.resumed` is truthy and one otherwise; it does not check equality to `true`.

The catch path interpolates `error.code`, using nullish coalescing to fall back to `knowledge_provider_probe_failed`. It performs no runtime validation of the code's type, length, or syntax. After storage opens, finally attempts closure.

The wrapper alone provides no evidence of a successful installed provider journey.
