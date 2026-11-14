<!-- lervo-release package="@lervo/cli" version="0.23.7" schema="1" -->

## What's changed

- Reuse a fully initialized coordination home and validated plain-checkout Git coordinates, so workforce reads stop repeating locks, fsyncs, and Git subprocesses.
