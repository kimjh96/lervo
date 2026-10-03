# Provider pauses and probes

Quota/authentication pauses use native normalized observations. An unknown reset stays paused until an explicitly requested, capability-free native probe produces matching structured proof and observed usage:

```bash
lervo knowledge convergence provider-probe --provider codex --json
```

The probe shares host admission and current delegation. It cannot erase a newer pause, infer recovery from elapsed time, or automatically retry an unknown reset. Private evidence stores the native observation; public status contains its hash and normalized reason.
