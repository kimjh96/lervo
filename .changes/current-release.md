<!-- lervo-release package="@lervo/cli" version="0.25.3" schema="1" -->

## What's changed

- Let the resident knowledge worker back off while convergence waits for a scheduled retry, and stop freshness from re-running and logging when its review cannot run, so an idle repository no longer runs a full knowledge cycle every two to three and a half minutes.
