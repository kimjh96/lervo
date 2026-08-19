import type { ExecuteManagedRun } from "./managed-run.js";
import type { ProjectStorage } from "@lervo/project-storage";

export interface CliIo {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliServices {
  executeManagedRun: ExecuteManagedRun;
  openProjectStorage(root: string): Promise<ProjectStorage>;
}

export type CliServiceOverrides = Partial<CliServices>;
