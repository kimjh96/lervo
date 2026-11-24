<!-- lervo-release package="@lervo/cli" version="0.46.6" schema="1" -->

## What's changed

- Retry knowledge convergence verification failures the host caused: a command that could not start or was not found retries with backoff, a timeout is reevaluated after six hours, and the integrator's failed candidate suite names its failed command instead of failing unclassified.
