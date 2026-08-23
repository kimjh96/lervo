import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import {
  defaultProjectDataPolicy,
  type ProjectManifest,
  validateSchema,
} from "@lervo/schemas";
import { parse, stringify } from "yaml";

import { readEntry } from "./filesystem.js";
import { resolveProjectPaths } from "./layout.js";
import {
  type CreateInitPlanOptions,
  LervoProjectError,
} from "./types.js";

function formatValidationErrors(
  errors: ReadonlyArray<{ instancePath: string; message?: string }>,
): string {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export function parseAndValidateYaml<T>(
  schema: "project" | "documentRegistry" | "documentManifest",
  content: string,
): T {
  let value: unknown;
  try {
    value = parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LervoProjectError("invalid_yaml", `Unable to read YAML: ${detail}`);
  }
  const validation = validateSchema(schema, value);
  if (!validation.valid) {
    throw new LervoProjectError(
      "contract_invalid",
      `The value does not satisfy the contract: ${formatValidationErrors(validation.errors)}`,
    );
  }
  return value as T;
}

export function serializeYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0 });
}

export function createDefaultManifest(
  options: CreateInitPlanOptions,
  root: string,
): ProjectManifest {
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    projectId:
      options.projectId ?? `prj_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    name: options.name ?? (basename(root) || "project"),
    root: ".",
    createdAt: (options.now ?? new Date()).toISOString(),
    dataPolicy: defaultProjectDataPolicy,
  };
  const validation = validateSchema("project", manifest);
  if (!validation.valid) {
    throw new LervoProjectError(
      "contract_invalid",
      `Unable to create the new project configuration: ${formatValidationErrors(validation.errors)}`,
    );
  }
  return manifest;
}

async function assertLervoDirectory(path: string): Promise<void> {
  const lervoDirectory = await readEntry(path);
  if (lervoDirectory.kind === "missing") {
    throw new LervoProjectError(
      "not_initialized",
      `${path} does not exist. Run lervo init first.`,
    );
  }
  if (lervoDirectory.kind !== "directory") {
    throw new LervoProjectError(
      "unsafe_path",
      `${path} must be a real directory and cannot be a symbolic link.`,
    );
  }
}

export async function loadProjectManifest(root: string): Promise<ProjectManifest> {
  const paths = resolveProjectPaths(root);
  await assertLervoDirectory(paths.lervoRoot);
  const entry = await readEntry(paths.projectManifest);
  if (entry.kind === "missing") {
    throw new LervoProjectError(
      "not_initialized",
      `${paths.projectManifest} does not exist. Run lervo init first.`,
    );
  }
  if (entry.kind !== "file") {
    throw new LervoProjectError(
      "unsafe_path",
      `${paths.projectManifest} must be a regular file and cannot be a symbolic link.`,
    );
  }
  return parseAndValidateYaml<ProjectManifest>("project", entry.content);
}
