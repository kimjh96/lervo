# Effect and invocation

The optional `managedExecution` Node factory configuration selects the concrete `work.managed_execution.v1` effect adapter. The adapter reads the exact CAS effect, validates its hash and derived plan fields, and binds responsibility, lease, provider, instructions, risk, and token reservation. The effect represents one initial attempt and authorizes neither retry ancestry nor rework.

Under the owner fence, the adapter launches the configured Node executable and CLI bundle. A bounded private stdin envelope carries the invocation and configured provider executable. The owner token remains only in trusted process memory and stdin. Events retain no token, request body, or raw process output.

The provider adapter creates the stored-login environment used by readiness inspection without inheriting API keys.
