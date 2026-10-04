# Request-scoped runtimes

`administration.allowedActions` may include `requested_runtime.manage` only when `requestedRuntimes` defines at least one target. Each target contains:

- `runtimeId`, `displayName`, an absolute `executable`, and `workingDirectory`.
- Optional bounded `arguments`.
- Optional credential-free loopback `healthUrl`.
- Optional `maximumLifetimeMs`, `startupTimeoutMs`, and `stopTimeoutMs` bounds.

Do not put tokens or other secrets in these fields.

The conversation exposes targets to the agent as bounded open and close capabilities. A person can ask naturally to start, open, stop, or close the server without an internal runtime ID or command syntax. The Node executes the configured target and observes startup before the same agent explains the result in the conversation language.

The Node owns the process after the provider turn, but never enables it at boot or restarts it after exit. Explicit close, maximum lifetime, and orderly Node shutdown stop the process group.

This facility serves a reviewed finite target, such as a development preview. It does not accept provider-authored commands or replace installation of Lervo's durable infrastructure services.
