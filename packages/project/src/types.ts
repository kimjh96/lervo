import type { ProjectManifest } from "@roven/schemas";

export type InitDirectoryOperation =
  | { kind: "directory"; path: string; action: "create" | "unchanged" }
  | { kind: "directory"; path: string; action: "conflict"; reason: string };

export type InitFileOperation =
  | { kind: "file"; path: string; action: "create"; content: string }
  | { kind: "file"; path: string; action: "unchanged"; expectedContentHash: string }
  | { kind: "file"; path: string; action: "conflict"; reason: string };

export type InitOperation = InitDirectoryOperation | InitFileOperation;

export interface InitPlan {
  schemaVersion: 1;
  root: string;
  status: "ready" | "blocked";
  projectManifest: ProjectManifest | null;
  operations: InitOperation[];
}

export interface InitApplyResult {
  projectManifest: ProjectManifest;
  created: string[];
  unchanged: string[];
}

export interface CreateInitPlanOptions {
  root: string;
  name?: string;
  now?: Date;
  projectId?: string;
}

export type ProjectErrorCode =
  | "contract_invalid"
  | "document_layout_conflict"
  | "init_conflict"
  | "invalid_yaml"
  | "not_initialized"
  | "plan_stale"
  | "unsafe_path";

export class RovenProjectError extends Error {
  constructor(
    readonly code: ProjectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RovenProjectError";
  }
}

export { RovenProjectError as RovenInitError };
