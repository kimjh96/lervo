<!-- lervo-release package="@lervo/cli" version="0.27.1" schema="1" -->

## What's changed

- Let lervo upgrade --apply accept the --approval plan ID that the previous release's host follower still sends, and print a JSON failure for every lervo upgrade --json argument error, so a follower no longer rolls a release back as unreadable.
