<!-- lervo-release package="@lervo/cli" version="0.30.2" schema="1" -->

## What's changed

- A Node upgrade no longer rolls back a release for a condition the predecessor never evaluated, a settled predecessor's own state counts as its readiness baseline, and the failing CLI records why its Node stage failed
