<!-- lervo-release package="@lervo/cli" version="0.25.6" schema="1" -->

## What's changed

- Let a resident knowledge cycle cancel its convergence, freshness or change-review provider call within a second once an upgrade waits for host admission, and start no such call while one waits, so an upgrade no longer waits for the call's whole timeout.
