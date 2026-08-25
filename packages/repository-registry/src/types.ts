export interface RepositoryRegistration {
  projectId: string;
  name: string;
  repositoryRoot: string;
  manifestSha256: string;
  registeredAt: string;
}

export interface RepositoryRegistry {
  schemaVersion: 1;
  kind: "lervo_repository_registry";
  repositories: RepositoryRegistration[];
}

export type RepositoryRegistrationChange = "registered" | "refreshed" | "unchanged";

export interface RegisterRepositoryResult {
  change: RepositoryRegistrationChange;
  registration: RepositoryRegistration;
}

export type NodeFleetServiceManager = "systemd" | "launchd";

export interface NodeFleetInstanceRegistration {
  serviceInstanceId: string;
  projectId: string;
  repositoryIdentityHash: string;
  repositoryRoot: string;
  nodeId: string;
  destinationId: string;
  runtimeVersion: string;
  serviceManager: NodeFleetServiceManager;
  serviceIdentity: string;
  healthPath: string;
  registeredAt: string;
  updatedAt: string;
}

export interface NodeFleetRegistry {
  schemaVersion: 1;
  kind: "lervo_node_fleet_registry";
  instances: NodeFleetInstanceRegistration[];
}

export type NodeFleetRegistrationChange = "registered" | "refreshed" | "unchanged";

export interface RegisterNodeFleetInstanceResult {
  change: NodeFleetRegistrationChange;
  registration: NodeFleetInstanceRegistration;
}

export type NodeFleetRegistryReconciliation = "register" | "refresh" | "unchanged";
export type NodeFleetServiceFileState = "absent" | "present_unverified" | "conflict";

export type NodeFleetDesiredInstance = Omit<
  NodeFleetInstanceRegistration,
  "registeredAt" | "updatedAt"
>;

export interface NodeFleetOnboardingAction {
  code:
    | "register_fleet_instance"
    | "refresh_fleet_instance"
    | "install_repository_service"
    | "review_service_conflict"
    | "review_legacy_singleton"
    | "issue_scoped_credentials"
    | "observe_runtime_readiness";
  state: "required" | "not_required" | "unobserved";
  authority:
    | "local_state_write"
    | "service_installation"
    | "service_transition"
    | "external_registration"
    | "runtime_observation";
  failureMeaning: string;
}

export interface NodeFleetOnboardingPlan {
  schemaVersion: 1;
  planKind: "repository_node_onboarding";
  planId: string;
  outcome: "reconcile_required" | "observation_required";
  verification: "manifest_revalidated";
  desired: NodeFleetDesiredInstance;
  registry: {
    path: string;
    reconciliation: NodeFleetRegistryReconciliation;
    current: NodeFleetInstanceRegistration | null;
  };
  service: {
    targetPath: string;
    targetState: NodeFleetServiceFileState;
    targetContentHash: string | null;
    legacyTargetPath: string;
    legacyTargetState: NodeFleetServiceFileState;
    legacyTargetContentHash: string | null;
    activation: "not_observed";
    readiness: "not_observed";
  };
  actions: NodeFleetOnboardingAction[];
  privacy: {
    scope: "local_plan_only";
    absolutePaths: "local_output_only";
    credentials: "excluded";
    serviceDefinitionBodies: "excluded";
  };
  staleIf: readonly [
    "project_manifest_changes",
    "fleet_registry_changes",
    "service_target_changes",
    "legacy_service_target_changes",
    "desired_coordinates_change",
  ];
}
