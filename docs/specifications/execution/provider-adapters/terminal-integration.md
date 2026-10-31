# Direct Terminal Integration

Terminal profiles merge approved handlers into project arrays, preserving settings and hooks. Handlers resolve the Git root from the provider working directory and invoke the generated terminal-only bundle through Node, never a PATH-resolved global `lervo`. The bundle verifies its exact manifest before handling input.

Legacy contract-v1 handlers migrate in place; generated-only runtime upgrades reconcile automatically. Reconciliation plan IDs bind the exact target bytes and latest canonical terminal-application event ID, allowing an old-to-new transition to recur safely after an intervening version without colliding with earlier recovery evidence. A changed event head makes the plan stale. User-owned provider configuration changes retain exact approval.

Invalid JSON or shapes, conflicting Lervo commands, Claude disablement, or Codex project-hook disablement blocks migration. Authority excludes local, global, and organization settings.

Successful apply is installation evidence, not activation readiness. Human and JSON output must immediately disclose Codex's one-time `/hooks` review. `terminal status` remains `action_required` until canonical contract-v2 invocations for both events are observed, distinguishing an unreviewed or unobserved Codex hook from a stale repository lifecycle.

[Native skill observation](native-skill-observation.md) defines transcript positions, resident parsing, invocation events, and the daily retirement review projection. The generated hook records metadata only; the full CLI runtime owns parsing.
