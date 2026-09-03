export type CollectionGrowthPolicy =
  | "durable_project_lifetime"
  | "bounded_count"
  | "replace_current"
  | "acknowledge_then_purge"
  | "journal_cleanup"
  | "age_count_byte_prune";

export interface GrowingCollectionContract {
  collectionId: string;
  owner: string;
  authority: "canonical" | "coordination" | "derived";
  growthPolicy: CollectionGrowthPolicy;
  maximumItems: number | null;
  operationWindow: number | null;
  overflow: "reject_before_mutation" | "bounded_backpressure" | "recovery_required";
  reconstruction: "not_applicable" | "events_and_cas" | "normal_producer";
}

export const foundationGrowingCollections: readonly GrowingCollectionContract[] = [
  {
    collectionId: "event_chain",
    owner: "event_store",
    authority: "canonical",
    growthPolicy: "durable_project_lifetime",
    maximumItems: null,
    operationWindow: 100_000,
    overflow: "recovery_required",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "cas_artifacts",
    owner: "cas",
    authority: "canonical",
    growthPolicy: "durable_project_lifetime",
    maximumItems: null,
    operationWindow: 100_000,
    overflow: "recovery_required",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "provider_sessions",
    owner: "orchestrator",
    authority: "canonical",
    growthPolicy: "durable_project_lifetime",
    maximumItems: null,
    operationWindow: 2_000,
    overflow: "reject_before_mutation",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "managed_write_journals",
    owner: "orchestrator",
    authority: "coordination",
    growthPolicy: "journal_cleanup",
    maximumItems: 1,
    operationWindow: 1,
    overflow: "recovery_required",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "assignments",
    owner: "agent_workforce",
    authority: "coordination",
    growthPolicy: "bounded_count",
    maximumItems: 10_000,
    operationWindow: 10_000,
    overflow: "reject_before_mutation",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "assignment_leases",
    owner: "agent_workforce",
    authority: "coordination",
    growthPolicy: "bounded_count",
    maximumItems: 10_000,
    operationWindow: 10_000,
    overflow: "reject_before_mutation",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "workspaces",
    owner: "agent_workforce",
    authority: "coordination",
    growthPolicy: "bounded_count",
    maximumItems: 10_000,
    operationWindow: 32,
    overflow: "bounded_backpressure",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "workspace_integration_queue",
    owner: "agent_workforce",
    authority: "coordination",
    growthPolicy: "bounded_count",
    maximumItems: 10_000,
    operationWindow: 32,
    overflow: "bounded_backpressure",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "terminal_observations",
    owner: "terminal_runtime",
    authority: "canonical",
    growthPolicy: "durable_project_lifetime",
    maximumItems: null,
    operationWindow: 2_000,
    overflow: "reject_before_mutation",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "terminal_receipts",
    owner: "terminal_runtime",
    authority: "derived",
    growthPolicy: "replace_current",
    maximumItems: 4,
    operationWindow: 4,
    overflow: "reject_before_mutation",
    reconstruction: "normal_producer",
  },
  {
    collectionId: "terminal_knowledge_lifecycle_cache",
    owner: "terminal_runtime",
    authority: "derived",
    growthPolicy: "replace_current",
    maximumItems: 1,
    operationWindow: 1,
    overflow: "reject_before_mutation",
    reconstruction: "normal_producer",
  },
  {
    collectionId: "capability_locks",
    owner: "capabilities",
    authority: "derived",
    growthPolicy: "replace_current",
    maximumItems: 1,
    operationWindow: 1,
    overflow: "reject_before_mutation",
    reconstruction: "normal_producer",
  },
  {
    collectionId: "capability_activation_receipts",
    owner: "capabilities",
    authority: "canonical",
    growthPolicy: "durable_project_lifetime",
    maximumItems: null,
    operationWindow: 2_000,
    overflow: "reject_before_mutation",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "sync_outbox",
    owner: "event_store",
    authority: "coordination",
    growthPolicy: "acknowledge_then_purge",
    maximumItems: null,
    operationWindow: 100,
    overflow: "bounded_backpressure",
    reconstruction: "events_and_cas",
  },
  {
    collectionId: "remote_command_replay",
    owner: "remote_command",
    authority: "coordination",
    growthPolicy: "bounded_count",
    maximumItems: 100_000,
    operationWindow: 1_024,
    overflow: "reject_before_mutation",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "deployment_attempts",
    owner: "organization_deployment",
    authority: "coordination",
    growthPolicy: "bounded_count",
    maximumItems: 100_000,
    operationWindow: 1_024,
    overflow: "reject_before_mutation",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "migration_journals",
    owner: "repository_knowledge",
    authority: "coordination",
    growthPolicy: "journal_cleanup",
    maximumItems: 1,
    operationWindow: 1,
    overflow: "recovery_required",
    reconstruction: "not_applicable",
  },
  {
    collectionId: "knowledge_projections",
    owner: "repository_knowledge",
    authority: "derived",
    growthPolicy: "replace_current",
    maximumItems: 3,
    operationWindow: 3,
    overflow: "reject_before_mutation",
    reconstruction: "normal_producer",
  },
] as const;

export interface FoundationCapacityProfile {
  profileId: "small" | "medium" | "large" | "concurrent";
  eventWindow: number;
  assignmentWindow: number;
  concurrentWorkers: number;
}

export const foundationCapacityProfiles: readonly FoundationCapacityProfile[] = [
  { profileId: "small", eventWindow: 1_000, assignmentWindow: 128, concurrentWorkers: 4 },
  { profileId: "medium", eventWindow: 10_000, assignmentWindow: 1_000, concurrentWorkers: 16 },
  { profileId: "large", eventWindow: 100_000, assignmentWindow: 10_000, concurrentWorkers: 32 },
  { profileId: "concurrent", eventWindow: 10_000, assignmentWindow: 1_000, concurrentWorkers: 32 },
] as const;

export function assertGrowingCollectionCoverage(collectionIds: readonly string[]): void {
  const byId = new Map(foundationGrowingCollections.map((item) => [item.collectionId, item]));
  if (byId.size !== foundationGrowingCollections.length) {
    throw new TypeError("A growing collection ID is duplicated.");
  }
  const missing = [...new Set(collectionIds)].filter((collectionId) => !byId.has(collectionId));
  if (missing.length > 0)
    throw new TypeError(`Growing collections are missing: ${missing.join(", ")}.`);
  for (const collection of foundationGrowingCollections) {
    if (
      collection.operationWindow === null ||
      collection.operationWindow < 1 ||
      (collection.maximumItems !== null &&
        (collection.maximumItems < 1 || collection.operationWindow > collection.maximumItems)) ||
      (collection.authority === "canonical" && collection.reconstruction !== "not_applicable") ||
      (collection.authority === "derived" && collection.reconstruction !== "normal_producer")
    ) {
      throw new TypeError(`Growing collection ${collection.collectionId} is invalid.`);
    }
  }
}
