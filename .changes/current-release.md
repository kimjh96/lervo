<!-- lervo-release package="@lervo/cli" version="0.25.0" schema="1" -->

## What's changed

- Follow published releases on every host with lervo host upgrade --follow: install the newest release, upgrade every registered repository, roll back by activation id on failure, and run as a user service.
- Keep lervo upgrade --apply and background knowledge cycles waiting through SQLite lock contention on the host full-cycle admission instead of failing with database is locked.
