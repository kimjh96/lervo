import type { DoctorInspection, DoctorScope } from "@lervo/diagnostics";
import type { EnvironmentObservation, EnvironmentSourceManifest } from "@lervo/environment";
import type { ProjectStorage } from "@lervo/project-storage";
import type { AssignmentMessageTriggerAdapterV1 } from "@lervo/agent-workforce";
import type {
  AssignmentConnectorPortV1,
  ImprovementObservationPortV1,
} from "@lervo/application-contract";

import type { ExecuteManagedRun } from "./managed-run.js";
import type {
  ExecuteAssignedManagedDeliberation,
  ExecuteManagedDeliberation,
} from "./managed-deliberation.js";
import type { GroundProductionRequest } from "./semantic-grounding.js";
import type { CreateTerminalStageObservation } from "./terminal-stage-observation.js";
import type { FinalizeGovernedAssignment } from "./governed-assignment-finalization.js";
import type { ReconcileGovernedAssignment } from "./governed-completion-reconciliation.js";
import type { InspectGovernedWork } from "./governed-work-inspection.js";
import type { InspectOperatingObjective } from "./operating-objective-inspection.js";
import type { InspectOperatingGoal } from "./operating-goal-inspection.js";
import type { InspectOperatingAttention } from "./operating-attention-inspection.js";
import type { InspectOperatingLiveness } from "./operating-liveness-inspection.js";
import type { InspectAssignmentCommunications } from "./assignment-communication-inspection.js";
import type {
  PrepareProductionSearchQueries,
  ProjectProductionSearchQueries,
} from "./provider-query-projector.js";
import type { CreateLocalImprovementObservationHost } from "./local-improvement-observation-host.js";
import type { ExecuteUnattendedScheduler } from "./unattended-scheduler.js";

export interface CliIo {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  stdin?: (maximumBytes?: number) => Promise<string>;
}

export interface CliServices {
  executeManagedRun: ExecuteManagedRun;
  executeManagedDeliberation: ExecuteManagedDeliberation;
  executeAssignedManagedDeliberation: ExecuteAssignedManagedDeliberation;
  executeUnattendedScheduler: ExecuteUnattendedScheduler;
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
  inspectOperatingGoal: InspectOperatingGoal;
  inspectOperatingAttention: InspectOperatingAttention;
  inspectOperatingLiveness: InspectOperatingLiveness;
  inspectAssignmentCommunications: InspectAssignmentCommunications;
  finalizeGovernedAssignment: FinalizeGovernedAssignment;
  reconcileGovernedAssignment: ReconcileGovernedAssignment;
  prepareSearchQueries?: PrepareProductionSearchQueries | undefined;
  assignmentConnectorPort?: AssignmentConnectorPortV1 | undefined;
  assignmentMessageTriggerAdapter?: AssignmentMessageTriggerAdapterV1 | undefined;
  improvementObservationPort?: ImprovementObservationPortV1 | undefined;
  createLocalImprovementObservationHost?: CreateLocalImprovementObservationHost | undefined;
}

export type CliServiceOverrides = Partial<CliServices>;
