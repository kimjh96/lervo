# Asset authority and supervision history

ADR-0438 adds a bounded exact asset sidecar and atomic authority transition; 57 local/Linux tests pass. All seven projects have compatible readers, but no per-project asset manifest grant had activated at this boundary.

ADR-0439 retains complete causal supervisor execution and validates the entire canonical chain; 69 local/Linux tests pass. An independent full-history comparison preserves identical managed-attempt/provider-resource facts.

Installed Lervo and Arca-next supervision are ready; AXLI retains `preflight_repair_requires_review`. Dormant workstreams are distinct from failed execution.
