import type { DoctorInspection, DoctorScope } from "@lervo/diagnostics";
import type { ProjectStorage } from "@lervo/project-storage";

import type { ExecuteManagedRun } from "./managed-run.js";

export interface CliIo {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliServices {
  executeManagedRun: ExecuteManagedRun;
  openProjectStorage(root: string): Promise<ProjectStorage>;
  inspectDoctorEnvironment(input: {
    repositoryRoot: string;
    projectId: string;
    scope?: DoctorScope;
  }): Promise<DoctorInspection[]>;
}

export type CliServiceOverrides = Partial<CliServices>;
