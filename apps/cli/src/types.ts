import type { DoctorInspection, DoctorScope } from "@lervo/diagnostics";
import type { EnvironmentObservation, EnvironmentSourceManifest } from "@lervo/environment";
import type { ProjectStorage } from "@lervo/project-storage";
import type { AssignmentConnectorPortV1 } from "@lervo/application-contract";

import type { ExecuteManagedRun } from "./managed-run.js";
import type { ExecuteManagedDeliberation } from "./managed-deliberation.js";
import type { GroundProductionRequest } from "./semantic-grounding.js";
import type { CreateTerminalStageObservation } from "./terminal-stage-observation.js";
import type { FinalizeGovernedAssignment } from "./governed-assignment-finalization.js";
import type { ReconcileGovernedAssignment } from "./governed-completion-reconciliation.js";
import type { InspectGovernedWork } from "./governed-work-inspection.js";
import type { InspectOperatingObjective } from "./operating-objective-inspection.js";
import type { InspectAssignmentCommunications } from "./assignment-communication-inspection.js";
import type {
  PrepareProductionSearchQueries,
  ProjectProductionSearchQueries,
} from "./provider-query-projector.js";

export interface CliIo {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  stdin?: () => Promise<string>;
}

export interface CliServices {
  executeManagedRun: ExecuteManagedRun;
  executeManagedDeliberation: ExecuteManagedDeliberation;
  openProjectStorage(root: string): Promise<ProjectStorage>;
  inspectDoctorEnvironment(input: {
    repositoryRoot: string;
    projectId: string;
    scope?: DoctorScope;
  }): Promise<DoctorInspection[]>;
  executeEnvironmentQuery(input: {
    source: EnvironmentSourceManifest;
    observedAt?: Date;
  }): Promise<EnvironmentObservation>;
  groundProductionRequest: GroundProductionRequest;
  projectSearchQueries: ProjectProductionSearchQueries;
  createTerminalStageObservation: CreateTerminalStageObservation;
  inspectGovernedWork: InspectGovernedWork;
  inspectOperatingObjective: InspectOperatingObjective;
  inspectAssignmentCommunications: InspectAssignmentCommunications;
  finalizeGovernedAssignment: FinalizeGovernedAssignment;
  reconcileGovernedAssignment: ReconcileGovernedAssignment;
  prepareSearchQueries?: PrepareProductionSearchQueries | undefined;
  assignmentConnectorPort?: AssignmentConnectorPortV1 | undefined;
}

export type CliServiceOverrides = Partial<CliServices>;
