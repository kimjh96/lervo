export type ManagedProviderRunPhase =
  | "request"
  | "before_snapshot"
  | "adapter_start"
  | "context_prepare"
  | "context_inject"
  | "turn_start"
  | "provider_turn"
  | "provider_stream"
  | "adapter_stop"
  | "after_snapshot";
