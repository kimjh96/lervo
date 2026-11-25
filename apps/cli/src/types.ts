import type { DoctorInspection, DoctorScope } from "@lervo/diagnostics";
import type { EnvironmentObservation, EnvironmentSourceManifest } from "@lervo/environment";
import type { ProjectStorage } from "@lervo/project-storage";

import type { ExecuteManagedRun } from "./managed-run.js";
import type {
  ExecuteAssignedManagedDeliberation,
  ExecuteManagedDeliberation,
} from "./managed-deliberation.js";
import type { CrossCheckDurableInstruction } from "./durable-instruction-cross-check.js";
import type { CrossCheckCapability } from "./capability-install-cross-check.js";
import type { CrossCheckPlan } from "./plan-cross-check.js";
import type { GroundProductionRequest } from "./semantic-grounding.js";
import type { CreateTerminalStageObservation } from "./terminal-stage-observation.js";
import type { InspectOperatingAttention } from "./operating-attention-inspection.js";
import type { KnowledgeMaterializationWaitTiming } from "./knowledge-materialization-wait.js";
import type { UpgradeResidentExclusionOptions } from "./upgrade-resident-exclusion.js";
import type { UpgradeHostOptions } from "./upgrade-host.js";

export interface CliIo {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  stdin?: (maximumBytes?: number) => Promise<string>;
  /**
   * ADR-0636: delivers a hook's complete answer before the hook finishes its records. Only the
   * resident context server provides it; a hook in its own process prints when it is done.
   */
  answer?: (stdout: string) => void;
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
  crossCheckDurableInstruction: CrossCheckDurableInstruction;
  /** ADR-0561 independent cross-check of a foreground plan before Lervo applies it. */
  crossCheckPlan: CrossCheckPlan;
  /** ADR-0561 one session of the stronger check a capability install needs. */
  crossCheckCapability?: CrossCheckCapability | undefined;
  createTerminalStageObservation: CreateTerminalStageObservation;
  inspectOperatingAttention: InspectOperatingAttention;
  /** Test seam for foreground waits on a live knowledge materialization owner. */
  knowledgeMaterializationWait?: KnowledgeMaterializationWaitTiming | undefined;
  /** Test seam for the upgrade's hold on the background resident's full-cycle admission. */
  knowledgeCycleAdmission?: UpgradeResidentExclusionOptions | undefined;
  /** Test seam: the home and process listing the upgrade's host-wide stages observe and change. */
  upgradeHost?: UpgradeHostOptions | undefined;
}

export type CliServiceOverrides = Partial<CliServices>;
