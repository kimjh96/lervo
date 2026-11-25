<!-- lervo-release package="@lervo/ade" version="0.5.0" schema="1" -->

Needs the Lervo CLI 0.43.0 or later.

## What's changed

- Stop the agent's running turn without ending the session: while the agent works, the empty reply card's button is Stop and Escape stops too, shown only when the Lervo core advertises decoder.interrupt.
- The session host names each native session when it opens the session's decoder in a resident Lervo process that advertises decoder.session, so Lervo can record what each turn used.
