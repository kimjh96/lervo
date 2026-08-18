import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import {
  defaultProjectDataPolicy,
  type ProjectManifest,
  validateSchema,
} from "@roven/schemas";
import { parse, stringify } from "yaml";

import { readEntry } from "./filesystem.js";
import { resolveProjectPaths } from "./layout.js";
import {
  type CreateInitPlanOptions,
  RovenProjectError,
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
    throw new RovenProjectError("invalid_yaml", `YAML을 읽을 수 없습니다: ${detail}`);
  }
  const validation = validateSchema(schema, value);
  if (!validation.valid) {
    throw new RovenProjectError(
      "contract_invalid",
      `계약에 맞지 않습니다: ${formatValidationErrors(validation.errors)}`,
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
    throw new RovenProjectError(
      "contract_invalid",
      `새 project 설정을 만들 수 없습니다: ${formatValidationErrors(validation.errors)}`,
    );
  }
  return manifest;
}

async function assertRovenDirectory(path: string): Promise<void> {
  const rovenDirectory = await readEntry(path);
  if (rovenDirectory.kind === "missing") {
    throw new RovenProjectError(
      "not_initialized",
      `${path}이 없습니다. 먼저 roven init을 실행하세요.`,
    );
  }
  if (rovenDirectory.kind !== "directory") {
    throw new RovenProjectError(
      "unsafe_path",
      `${path}은 실제 디렉터리여야 하며 심볼릭 링크일 수 없습니다.`,
    );
  }
}

export async function loadProjectManifest(root: string): Promise<ProjectManifest> {
  const paths = resolveProjectPaths(root);
  await assertRovenDirectory(paths.rovenRoot);
  const entry = await readEntry(paths.projectManifest);
  if (entry.kind === "missing") {
    throw new RovenProjectError(
      "not_initialized",
      `${paths.projectManifest}이 없습니다. 먼저 roven init을 실행하세요.`,
    );
  }
  if (entry.kind !== "file") {
    throw new RovenProjectError(
      "unsafe_path",
      `${paths.projectManifest}은 일반 파일이어야 하며 심볼릭 링크일 수 없습니다.`,
    );
  }
  return parseAndValidateYaml<ProjectManifest>("project", entry.content);
}
