# Process integration and other surfaces

## Installed process adapter

Before invoking the configured Lervo CLI, the installed process adapter prepends the running Node executable's directory to child `PATH`. This preserves the explicit runtime dependency of `/usr/bin/env node` script entrypoints, including systemd services whose inherited `PATH` omits the private runtime installation.

Child stdout and stderr remain bounded; user-facing replies never include child stderr. Operator diagnostics retain typed launch, exit, output, source, or artifact failure meaning instead of relabeling all process failures as repository-history explanations.

## Other surfaces and initiation

The future first-party decision room renders the same proposals, objections, revisions, verification, adopted claims, unresolved objections, terminal status, resources, and source links. Neither surface exposes private reasoning or provider conversations.

Exact commands remain available for policy selection, status, resume, and diagnostics. Natural start requires an explicit human request and a configured default policy. Product recommendations are read-only and cannot invoke `deliberation.start`.
