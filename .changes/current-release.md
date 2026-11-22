<!-- lervo-release package="@lervo/cli" version="0.31.0" schema="1" -->

## What's changed

- The Hub re-signs unchanged policy snapshots before they expire, and Lervo writes its own repository changes only on the base branch, always as their own commit, so nothing stays uncommitted in an owner's feature-branch checkout.
