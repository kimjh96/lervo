# Reader compatibility

Event-reader compatibility is a provider-neutral, rebuildable capability observation, not writer authority. Local diagnostics and Node health advertise their readable envelope versions. Hub exposes the same secret-free report through an identity-bound health endpoint that sync clients read without sending bearer credentials.

Missing or incapable peers cannot authorize v2 writing. Local execution and v1 writing remain independent of Hub availability.

For a Hub-enabled project, the existing owner-only Node fleet registry is the complete configured membership authority. The service definition and runtime config bind its Node and Hub observation sources. Planning and apply each re-observe exact capability and identity without creating another reader registry.
