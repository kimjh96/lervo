# Constrained results

Both adapters support an opt-in JSON Schema result constraint through native boundaries: Claude uses the SDK output format; Codex uses app-server `turn/start.outputSchema`. Unconfigured turns omit the constraint.

Consumers must still normalize and validate constrained results: provider-native schema acceptance proves neither correctness nor semantic use.
