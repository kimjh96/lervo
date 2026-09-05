# Run and verify

Configure a provider and tracked suite under `.lervo/verifications/`, then use the one-file managed boundary:

```sh
lervo run --provider codex --path src/example.ts --verification project.quick \
  "Implement the requested change"
lervo run --provider claude --path src/example.ts --verification project.quick \
  "Review and update the requested change"
```

The suite and result checks must pass. Result prose is evaluated in a read-only local provider session. See `lervo --help` for all commands.

Built-in and validated repository roles use this boundary. `lervo role list|show|validate` inspects exact contracts; workforce commands manage agents and handoffs.
