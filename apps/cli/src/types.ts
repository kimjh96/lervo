import type { DoctorInspection, DoctorScope } from "@lervo/diagnostics";
import type { EnvironmentObservation, EnvironmentSourceManifest } from "@lervo/environment";
import type { ProjectStorage } from "@lervo/project-storage";

import type { ExecuteManagedRun } from "./managed-run.js";
import type {
  ExecuteAssignedManagedDeliberation,
  ExecuteManagedDeliberation,
} from "./managed-deliberation.js";
import type { GroundProductionRequest } from "./semantic-grounding.js";
import type { CreateTerminalStageObservation } from "./terminal-stage-observation.js";
import type { InspectOperatingAttention } from "./operating-attention-inspection.js";
import type {
  PrepareProductionSearchQueries,
  ProjectProductionSearchQueries,
} from "./provider-query-projector.js";
import type { KnowledgeMaterializationWaitTiming } from "./knowledge-materialization-wait.js";
import type { UpgradeResidentExclusionOptions } from "./upgrade-resident-exclusion.js";
import type { UpgradeHostOptions } from "./upgrade-host.js";

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
  inspectOperatingAttention: InspectOperatingAttention;
  prepareSearchQueries?: PrepareProductionSearchQueries | undefined;
  /** Test seam for foreground waits on a live knowledge materialization owner. */
  knowledgeMaterializationWait?: KnowledgeMaterializationWaitTiming | undefined;
  /** Test seam for the upgrade's hold on the background resident's full-cycle admission. */
  knowledgeCycleAdmission?: UpgradeResidentExclusionOptions | undefined;
  /** Test seam: the home and process listing the upgrade's host-wide stages observe and change. */
  upgradeHost?: UpgradeHostOptions | undefined;
}

export type CliServiceOverrides = Partial<CliServices>;
