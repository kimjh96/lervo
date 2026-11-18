<!-- lervo-release package="@lervo/cli" version="0.25.7" schema="1" -->

## What's changed

- Let the host follower install a newer release at a retry pass's repository boundary at once, stop hourly rechecks of owner-approval blocks with nothing to apply, skip a --safe apply that would refuse, time every apply, and skip lint when an apply changed nothing.
