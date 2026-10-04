# Report contract

Each capability report contains:

- Protocol-matching `schemaVersion` and `kind: product_host.capabilities`.
- Protocol transport, version, discovery command, and `requiresHub: false`.
- Canonical authority classes products must not duplicate.
- Rebuildable projection classes products may render or transform.
- Ordered route descriptors with area, operation, stable result-contract identifier, command prefix, output, effect, authority, and availability.
- Explicit unsupported product capabilities.

Command arrays omit the executable and repository-specific arguments. Products invoke installed `lervo`, add required route arguments, and request the declared output. Help text is human guidance, not machine discovery.
