# Provider Adapter Specification

Status: `active`
As of: 2026-08-30

## Scope

Defines provider-neutral adapter telemetry, direct terminal integration, publication evaluation, and result projection. The parent [execution and evidence specification](../execution.md) defines the managed-run lifecycle and assurance levels.

## Adapter telemetry

Codex and Claude share contract tests. They normalize native session, capability-activation, tool, usage, error, and result events without inventing telemetry. Provider-specific MCP configuration, plugin loading, and confirmation remain behind adapter boundaries.

Claude usage comes from the SDK result's cumulative per-model totals. Complete input includes non-cached, cache-read, and cache-creation input; cache-read remains separately observable. Reasoning output is zero because the SDK exposes no separate count. Empty or malformed totals emit `invalid_provider_usage`. Usage excludes cost, model identifiers, prompts, and output and is not a billing statement.

Both adapters offer an opt-in JSON Schema result constraint through native boundaries: Claude uses the SDK output format; Codex uses app-server `turn/start.outputSchema`. Unconfigured turns omit it. Consumers must still normalize and validate constrained results because provider-native schema acceptance proves neither correctness nor semantic use.

The default-off managed linked-evidence canary uses this boundary for at most one isolated selection turn. Core code owns eligibility, the relational v17 protocol, exact token validation, source reload, E1–E4 separation, and bounded storage. Each adapter owns only its native schema carrier, context delivery, events, usage normalization, result binding, and stop behavior. Disabled and coordinate-ineligible runs create no selection adapter.

The active ordinary managed-run path does not use that selection-turn boundary. Core code deterministically selects the bounded current linked projection before creating the ordinary Codex or Claude task adapter. It creates no selection adapter and needs no provider-specific branch, API key, or user setting.

After adapter start and before candidate injection or a model turn, the canary requires the session to report `toolCalls`, `commandExecution`, and `fileChanges` as `unsupported`. A mismatch records a bounded selection failure and stops the session with zero selection turns. An accepted turn is never retried, repaired, or replaced.

Claude's explicit empty tool list reports `toolCalls` unsupported. Codex app-server 0.150.1 has no thread- or turn-level no-tool control, so an app-server read-only session remains ineligible even when its filesystem sandbox is read-only and approvals are denied. Sandbox and approval settings must never prove that tools or commands are unavailable.

Codex also has an opt-in, selection-only Responses API transport. It accepts only read-only sessions without capability activations and requires an explicit API credential and model. Every request binds `tools: []`, `tool_choice: "none"`, `store: false`, and the existing strict JSON Schema result constraint. Its effective tool, command, file-change, and compaction capabilities are unsupported.

Missing configuration makes no HTTP request. Non-message output, incomplete results, HTTP failure, or invalid usage fails the turn without persisting credentials or provider response bodies. Ordinary managed Codex execution remains on app-server.

The Responses transport is an optional internal BYOK or CI path, not the primary managed-context activation path. General Lervo users need not register provider API keys. V3's provider-free projection of passed V18 selections was rejected before execution because it added almost no context. V4 proved the deterministic population. v5 binds the implemented runtime: it selects every bounded current linked candidate without creating a selection adapter, then sends only the ordinary read-only task through the existing Codex or Claude adapter and its native signed-in session. No provider-specific selection transport or historical selection telemetry is projected into the current task run.

## Direct terminal integration

Terminal profiles merge approved handlers into project arrays while preserving settings and hooks. Handlers resolve the Git root from the provider working directory and invoke the generated terminal-only bundle through Node, never a PATH-resolved global `lervo`. The bundle verifies its exact manifest before handling input.

Legacy contract-v1 handlers migrate in place. Generated-only runtime upgrades reconcile automatically. Reconciliation plan IDs bind the exact target bytes and latest canonical terminal-application event ID. This permits an old-to-new transition to recur safely after an intervening version without colliding with earlier recovery evidence. A changed event head makes the plan stale. User-owned provider configuration changes retain exact approval.

Invalid JSON or shapes, conflicting Lervo commands, Claude disablement, or Codex project-hook disablement blocks migration. Authority excludes local, global, and organization settings.

Successful apply is installation evidence, not activation readiness. Human and JSON output must immediately disclose Codex's one-time `/hooks` review. `terminal status` remains `action_required` until canonical contract-v2 invocations for both events are observed, distinguishing an unreviewed or unobserved Codex hook from a stale repository lifecycle.

## Publication evaluation and projection

Managed runs use a role-bound English machine-result protocol. A separate read-only session of the selected local provider evaluates human-facing publication in an empty temporary repository without documents, tools, or write access. Its exact JSON is content-bound evidence. It is not independent cross-provider or human review, proof of understanding, or writing-policy E3. Failure blocks publication and CLI success, but not an already verified file change.

The validated result is the E4 source. Both adapters carry the same provider-neutral evidence-token instruction. The runtime does not post-filter matching tokens against task ground truth. Before publication, remove only exact evidence tokens for current E3 versions and store the human artifact under a separate digest. Writing checks, permits, `run.completed`, and display bind to that projection. `adapter.result.captured` retains the unprojected digest without content. Unknown tokens remain visible. An empty projection fails closed.

Managed canary v12 showed that prompt-only citation minimization was not common-contract control: it reduced Codex recall while leaving Claude per-run precision failures, so the experiment was rolled back. ADR-0293 adds required `task_evidence` and `governance_context` roles to provider-neutral envelope and receipt documents. ADR-0297 independently adds required `referenceEligible` state after v14 showed that linked supporting task context was still over-citable. Both adapters serialize role and eligibility identically. Only eligible task evidence has an exact E4 token; supporting task context and governance context have null tokens. A receipt that changes either value is rejected, and a fabricated token for an ineligible document creates no E4 evidence. Raw provider output is not rewritten or compared with hidden evaluation identifiers. V18 passed the unchanged Codex-Claude gates, and ADR-0301 activates this provider-neutral boundary for ordinary managed runs without changing adapter behavior.
