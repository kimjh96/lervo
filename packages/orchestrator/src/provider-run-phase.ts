export type ManagedProviderRunPhase =
  | "request"
  | "before_snapshot"
  | "adapter_start"
  | "context_prepare"
  | "context_inject"
  | "write_bridge"
  | "turn_start"
  | "provider_turn"
  | "result_collect"
  | "result_store"
  | "provider_stream"
  | "adapter_stop"
  | "after_snapshot";
