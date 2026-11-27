<!-- lervo-release package="@lervo/cli" version="0.66.1" schema="1" -->

## What's changed

- Child processes that exit before reading their input no longer crash Lervo with an uncaught EPIPE, and calls whose input was cut short now fail.
- Move no-capability provider CLI invocation behind adapter strategies; the knowledge compiler no longer names providers.
- Split the repository layout migration planner into per-phase modules without changing plan output.
