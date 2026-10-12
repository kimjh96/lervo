import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { defaultProjectDataPolicy, type ProjectManifest, validateSchema } from "@lervo/schemas";
import { formatValidationErrors } from "./yaml-contract.js";
import { createProjectManifestParser } from "./project-manifest-parser.js";
export { parseAndValidateYaml, serializeYaml } from "./yaml-contract.js";

import { readSmallEntry } from "./small-entry.js";
import { readEntry } from "./filesystem.js";
import { resolveProjectPaths } from "./layout.js";
import { type CreateInitPlanOptions, LervoProjectError } from "./types.js";

const parseProjectManifest = createProjectManifestParser();

export function createDefaultManifest(
  options: CreateInitPlanOptions,
  root: string,
): ProjectManifest {
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    projectId: options.projectId ?? `prj_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
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
    throw new LervoProjectError("not_initialized", `${path} does not exist. Run lervo init first.`);
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
  const entry = await readSmallEntry(paths.projectManifest);
  if (entry.kind === "missing") {
    throw new LervoProjectError(
      "not_initialized",
      `${paths.projectManifest} does not exist. Run lervo init first.`,
    );
  }
  if (entry.kind !== "file") {
    const detail = entry.kind === "unsupported" ? ` (${entry.description})` : "";
    throw new LervoProjectError(
      "unsafe_path",
      `${paths.projectManifest} must be a regular file and cannot be a symbolic link${detail}.`,
    );
  }
  return parseProjectManifest(entry.content);
}
