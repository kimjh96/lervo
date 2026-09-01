import { eventPayloadAllowlists } from "@lervo/event-contract";
import { eventTypes } from "@lervo/schemas";

export type TelemetryPurpose =
  | "identity_binding"
  | "integrity_binding"
  | "bounded_measurement"
  | "repository_coordinate"
  | "time_coordinate"
  | "bounded_state";

export interface TelemetryFieldDeclaration {
  eventType: string;
  field: string;
  purpose: TelemetryPurpose;
  privacy: "opaque" | "aggregate" | "repository_relative" | "bounded_coordinate";
  retention: "canonical_event_lifetime";
  cardinality: "bounded_by_closed_event_schema";
  export: "local_and_authorized_project_nodes";
}

const forbiddenRawField =
  /(?:prompt|transcript|credential|secret|raw|body|requestText|contextText|providerOutput)/iu;

function telemetryPurpose(field: string): TelemetryPurpose {
  if (/(?:At|Timestamp|durationMs|expiresAt)$/u.test(field)) return "time_coordinate";
  if (/(?:Tokens|Count|Bytes|byteCount|rank|score|priority|ordinal|seq)$/u.test(field))
    return "bounded_measurement";
  if (/(?:path|cwdRelative)$/iu.test(field)) return "repository_coordinate";
  if (/(?:Id|Ids)$/u.test(field)) return "identity_binding";
  if (/(?:Hash|Digest|Revision|Version|generation)$/u.test(field)) return "integrity_binding";
  return "bounded_state";
}

export function createEventTelemetryRegistry(): TelemetryFieldDeclaration[] {
  const allowlists = eventPayloadAllowlists as Record<string, readonly string[]>;
  const listedTypes = Object.keys(allowlists).sort();
  const expectedTypes = [...eventTypes].sort();
  if (JSON.stringify(listedTypes) !== JSON.stringify(expectedTypes)) {
    throw new TypeError("The event telemetry registry does not cover every event type.");
  }
  return listedTypes.flatMap((eventType) =>
    allowlists[eventType]!.map((field) => {
      if (forbiddenRawField.test(field)) {
        throw new TypeError(
          `Event telemetry contains a forbidden raw field: ${eventType}.${field}.`,
        );
      }
      const purpose = telemetryPurpose(field);
      return {
        eventType,
        field,
        purpose,
        privacy:
          purpose === "identity_binding" || purpose === "integrity_binding"
            ? "opaque"
            : purpose === "bounded_measurement"
              ? "aggregate"
              : purpose === "repository_coordinate"
                ? "repository_relative"
                : "bounded_coordinate",
        retention: "canonical_event_lifetime",
        cardinality: "bounded_by_closed_event_schema",
        export: "local_and_authorized_project_nodes",
      } satisfies TelemetryFieldDeclaration;
    }),
  );
}

export const foundationThreatIds = [
  "prompt_authority_injection",
  "path_or_symlink_escape",
  "secret_or_telemetry_leakage",
  "malicious_capability_dependency",
  "tool_schema_substitution",
  "event_or_receipt_forgery",
  "replay",
  "cross_repository_or_tenant_confusion",
  "hook_latency_denial",
  "graph_fanout_denial",
  "cost_amplification",
  "poisoned_improvement_candidate",
  "ui_truth_confusion",
  "external_effect_ambiguity",
  "untrusted_third_party_execution",
] as const;

export interface FoundationThreatControl {
  threatId: (typeof foundationThreatIds)[number];
  disposition: "mitigated" | "disabled_pending_isolation";
  controls: string[];
  evidencePaths: string[];
}

export const foundationThreatModel: readonly FoundationThreatControl[] = [
  {
    threatId: "prompt_authority_injection",
    disposition: "mitigated",
    controls: ["typed_grounding", "exact_authority_coordinates"],
    evidencePaths: [
      "packages/request-grounding/test/request-grounding.test.ts",
      "apps/cli/test/semantic-grounding.test.ts",
    ],
  },
  {
    threatId: "path_or_symlink_escape",
    disposition: "mitigated",
    controls: ["repository_relative_validation", "no_follow_open", "snapshot_scope"],
    evidencePaths: [
      "packages/documents/test/document-migration-apply.test.ts",
      "packages/project/test/state-retention.test.ts",
    ],
  },
  {
    threatId: "secret_or_telemetry_leakage",
    disposition: "mitigated",
    controls: ["event_allowlist", "bounded_errors", "runtime_only_credentials"],
    evidencePaths: [
      "packages/event-contract/test/redaction.test.ts",
      "packages/organization-credential-source-file/test/owner-only-file-source.test.ts",
    ],
  },
  {
    threatId: "malicious_capability_dependency",
    disposition: "mitigated",
    controls: ["exact_dependency_lock", "hash_validation", "permission_intersection"],
    evidencePaths: [
      "packages/capabilities/test/capabilities.test.ts",
      "packages/capabilities/test/capabilities.test.ts",
    ],
  },
  {
    threatId: "tool_schema_substitution",
    disposition: "mitigated",
    controls: ["descriptor_hash", "activation_receipt_binding"],
    evidencePaths: [
      "packages/capabilities/test/capabilities.test.ts",
      "packages/orchestrator/test/capability-invocation-events.test.ts",
    ],
  },
  {
    threatId: "event_or_receipt_forgery",
    disposition: "mitigated",
    controls: ["hash_chain", "schema_validation", "identity_binding"],
    evidencePaths: [
      "packages/event-contract/test/event-chain.test.ts",
      "packages/event-store-sqlite/test/event-store.test.ts",
    ],
  },
  {
    threatId: "replay",
    disposition: "mitigated",
    controls: ["idempotency_key", "nonce_fence", "generation"],
    evidencePaths: [
      "packages/remote-command-sqlite/test/replay-store.test.ts",
      "packages/organization-deployment-sqlite/test/replay-store.test.ts",
    ],
  },
  {
    threatId: "cross_repository_or_tenant_confusion",
    disposition: "mitigated",
    controls: ["project_scope", "repository_identity", "destination_binding"],
    evidencePaths: [
      "packages/hub-sync-sqlite/test/trace-integration.test.ts",
      "packages/sync/test/workstream-replication.test.ts",
    ],
  },
  {
    threatId: "hook_latency_denial",
    disposition: "mitigated",
    controls: ["availability_safe_empty_response", "bounded_context", "performance_budget"],
    evidencePaths: [
      "apps/cli/test/terminal-integration.test.ts",
      "docs/evidence/foundation/execution-performance-v1.json",
    ],
  },
  {
    threatId: "graph_fanout_denial",
    disposition: "mitigated",
    controls: ["delegation_depth", "dependency_fanout", "integration_batch_bound"],
    evidencePaths: [
      "packages/agent-workforce/test/assignment-graph.test.ts",
      "packages/agent-workforce/test/workspace-lifecycle.test.ts",
    ],
  },
  {
    threatId: "cost_amplification",
    disposition: "mitigated",
    controls: ["provider_signal_bound", "normalization_batch_bound", "no_unattended_loop"],
    evidencePaths: [
      "packages/orchestrator/test/managed-provider-run-failures.test.ts",
      "packages/repository-knowledge/test/document-normalization.test.ts",
    ],
  },
  {
    threatId: "poisoned_improvement_candidate",
    disposition: "mitigated",
    controls: ["candidate_not_truth", "reviewed_promotion", "exact_approval"],
    evidencePaths: [
      "apps/cli/test/development-pattern-command.test.ts",
      "apps/cli/test/development-pattern-command.test.ts",
    ],
  },
  {
    threatId: "ui_truth_confusion",
    disposition: "mitigated",
    controls: ["canonical_projection_boundary", "evidence_state_separation"],
    evidencePaths: [
      "packages/context-coverage/test/projector.test.ts",
      "packages/diagnostics/test/terminal-coverage.test.ts",
    ],
  },
  {
    threatId: "external_effect_ambiguity",
    disposition: "mitigated",
    controls: ["reconcile_after_uncertainty", "no_automatic_retry", "recovery_required"],
    evidencePaths: [
      "packages/orchestrator/test/workspace-integration.test.ts",
      "packages/organization-deployment-contract/test/organization-fleet.test.ts",
    ],
  },
  {
    threatId: "untrusted_third_party_execution",
    disposition: "disabled_pending_isolation",
    controls: ["no_dynamic_module_loading", "explicit_activation", "local_fallback"],
    evidencePaths: [
      "docs/specifications/execution/capabilities.md",
      "packages/capabilities/test/capabilities.test.ts",
    ],
  },
] as const;

export function assertFoundationThreatModel(): void {
  const byId = new Map(foundationThreatModel.map((item) => [item.threatId, item]));
  if (
    byId.size !== foundationThreatIds.length ||
    foundationThreatIds.some((threatId) => !byId.has(threatId)) ||
    foundationThreatModel.some(
      (item) => item.controls.length === 0 || item.evidencePaths.length === 0,
    ) ||
    byId.get("untrusted_third_party_execution")?.disposition !== "disabled_pending_isolation"
  ) {
    throw new TypeError("The integrated foundation threat model is incomplete.");
  }
}
