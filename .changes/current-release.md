<!-- lervo-release package="@lervo/cli" version="0.30.1" schema="1" -->

## What's changed

- A restarted Node whose first supervision cycle outlasts its startup grace now still evaluates its owner, readiness counts only the replacement's heartbeat, and a rolled-back release keeps why it failed
