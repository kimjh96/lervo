<!-- lervo-release package="@lervo/cli" version="0.25.2" schema="1" -->

## What's changed

- Describe the bundled Node runtime once per lervo upgrade command instead of up to nine times, and report stageTimings in lervo upgrade --apply receipts and host follower pass entries.
- Let runtime retention read the --config of the host follower, host resident, and replica coordinator services, so lervo upgrade retires unreferenced Node runtimes again instead of always reporting runtime_references_unavailable.
- Plan every lervo migrate knowledge stage, and so each lervo upgrade knowledge inspection, from one repository scan instead of one scan per stage.
- Read systemd drop-ins for Node runtime retention, retire runtimes only in the planned lervo upgrade stage instead of during Node onboarding and rollback, and escape a literal $ in systemd service commands.
