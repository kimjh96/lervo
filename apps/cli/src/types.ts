import type { DoctorInspection, DoctorScope } from "@lervo/diagnostics";
import type { EnvironmentObservation, EnvironmentSourceManifest } from "@lervo/environment";
import type { ProjectStorage } from "@lervo/project-storage";

import type { ExecuteManagedRun } from "./managed-run.js";
import type { ExecuteManagedDeliberation } from "./managed-deliberation.js";
import type { GroundProductionRequest } from "./semantic-grounding.js";

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
}

export type CliServiceOverrides = Partial<CliServices>;
