<!-- lervo-release package="@lervo/cli" version="0.47.8" schema="1" -->

## What's changed

- Refresh the next prompt's knowledge snapshot after each resident refresh, so a resident commit no longer costs the next prompt a full knowledge scan past the hook budget.
