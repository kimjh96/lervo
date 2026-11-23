<!-- lervo-release package="@lervo/cli" version="0.43.2" schema="1" -->

## What's changed

- Context quality recording works on repositories whose event writer is past schema version 6; it had reported writer_not_active on every repository at version 7 or later.
