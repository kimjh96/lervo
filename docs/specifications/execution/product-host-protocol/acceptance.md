# Product-host external-consumer acceptance

`pnpm smoke:packed-cli` builds the real tarball, installs it into an empty temporary consumer, and runs the protocol without workspace imports. The fixture verifies:

- Default 21-route v1 and explicit 23-route v2, 24-route v3, 26-route v4, 27-route v5, 29-route v6, and 38-route v7 reports.
- The exact connector limitation and unsupported capabilities.
- Absence of workspace coordinates and private Lervo package installation.

Using only CLI commands, it then:

1. Initializes a local repository and hires source and recipient agents.
2. Plans and applies one current workstream.
3. Creates and lists one assignment.
4. Inspects the objective, composed goal lifecycle, governed graph, and observed budgets.
5. Inspects an empty valid assignment thread and recipient inbox.
6. Renders a deterministic static operating board.
7. Inspects current operating attention through protocol v2.
8. Activates the v2 event writer, records a privacy-bounded root heartbeat, and inspects operating liveness through protocol v3.
9. Routes one reviewed direct-message artifact through exact plan/apply, proves source-event replay is current, records acknowledgment for the exact recipient-agent coordinate, and confirms delivery remains unobserved through protocol v4.
10. Invokes the installed bounded scheduler once, observes it claim one queued assignment at the exact revision and execute it through managed execution, and verifies completion without a Hub or another manual trigger.
11. Applies one reviewed four-node graph-v2 topology, replays one valid branch and join, invokes the installed scheduler, and verifies dependency-ordered completion of all four canonical assignments.
12. Discovers named-agent hire and rename, exact team creation and reclassification, multi-team inspection, and replay-safe organization-executive effect routes through protocol v7.

Acceptance uses no Hub, provider, network route, or live connector effect. Focused adapter and replay tests verify repository-root allowlisting, Discord request scoping, exact response validation, durable receipts, and fail-closed uncertain outcomes. Cross-platform release matrices remain responsible for broader installation evidence.
