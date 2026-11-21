<!-- lervo-release package="@lervo/cli" version="0.30.0" schema="1" -->

## What's changed

- Knowledge publication follows each repository's merge policy, reviews cannot be broken by a mistyped hash, and non-owner hosts no longer pile up knowledge jobs
- Knowledge publication reads what is published from GitHub on every host, stops polling GitHub after a bounded wait, keeps closed pull requests closed, and adds lervo knowledge convergence owner acknowledge
