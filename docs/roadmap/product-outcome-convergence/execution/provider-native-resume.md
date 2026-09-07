# Provider-native session resume

State: `external dependency`

Outcome: an adapter restores provider-native conversation memory for the same session.

Codex and Claude report native `sessionResume: unsupported`. Acceptance requires a provider transport exposing native resume and independent evidence of restored state.

Add adapter-specific native resume only when that external capability exists. Keep it optional; it must not replace portable repository checkpoints.
