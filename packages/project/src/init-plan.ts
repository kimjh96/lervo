import { resolve } from "node:path";

import type { ProjectManifest } from "@lervo/schemas";

import {
  createDefaultManifest,
  parseAndValidateYaml,
  serializeYaml,
} from "./config.js";
import { planDocumentStorage } from "./document-init-plan.js";
import { contentHash, readEntry } from "./filesystem.js";
import { lervoRelativePaths, previousBrandRelativePaths } from "./layout.js";
import {
  type CreateInitPlanOptions,
  type InitFileOperation,
  type InitOperation,
  type InitPlan,
  LervoProjectError,
} from "./types.js";

const managedDirectories = [
  lervoRelativePaths.root,
  lervoRelativePaths.generated,
  lervoRelativePaths.state,
  lervoRelativePaths.knowledge,
] as const;

async function planDirectory(root: string, path: string): Promise<InitOperation> {
  const entry = await readEntry(resolve(root, path));
  if (entry.kind === "missing") {
    return { kind: "directory", path, action: "create" };
  }
  if (entry.kind === "directory") {
    return { kind: "directory", path, action: "unchanged" };
  }
  return {
    kind: "directory",
    path,
    action: "conflict",
    reason: `${path}에 디렉터리를 만들 수 없습니다. 기존 ${entry.kind === "file" ? "파일" : entry.description}을 보존했습니다.`,
  };
}

async function planManagedFile(input: {
  root: string;
  path: string;
  desiredContent: string;
  validateExisting?: (content: string) => void;
}): Promise<InitFileOperation> {
  const entry = await readEntry(resolve(input.root, input.path));
  if (entry.kind === "missing") {
    return { kind: "file", path: input.path, action: "create", content: input.desiredContent };
  }
  if (entry.kind !== "file") {
    const description = entry.kind === "directory" ? "디렉터리" : entry.description;
    return {
      kind: "file",
      path: input.path,
      action: "conflict",
      reason: `${input.path}의 기존 ${description}을 덮어쓰지 않습니다.`,
    };
  }
  try {
    input.validateExisting?.(entry.content);
  } catch (error) {
    return {
      kind: "file",
      path: input.path,
      action: "conflict",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    kind: "file",
    path: input.path,
    action: "unchanged",
    expectedContentHash: contentHash(entry.content),
  };
}

export async function createInitPlan(options: CreateInitPlanOptions): Promise<InitPlan> {
  const root = resolve(options.root);
  const rootEntry = await readEntry(root);
  if (rootEntry.kind !== "directory") {
    throw new LervoProjectError(
      "unsafe_path",
      `초기화 대상 ${root}은 존재하는 디렉터리여야 합니다.`,
    );
  }

  const previousBrandRoot = await readEntry(resolve(root, previousBrandRelativePaths.root));
  if (previousBrandRoot.kind !== "missing") {
    return {
      schemaVersion: 1,
      root,
      status: "blocked",
      projectManifest: null,
      operations: [{
        kind: "directory",
        path: lervoRelativePaths.root,
        action: "conflict",
        reason: `이전 제품명으로 만든 ${previousBrandRelativePaths.root} 경로가 있습니다. Lervo는 이 경로를 자동 변환하거나 ${lervoRelativePaths.root}와 함께 사용하지 않습니다. 기존 상태를 보존한 뒤 명시적인 명칭 migration을 사용해야 합니다.`,
      }],
    };
  }

  const operations: InitOperation[] = [];
  const lervoRootOperation = await planDirectory(root, managedDirectories[0]);
  operations.push(lervoRootOperation);
  if (lervoRootOperation.action === "conflict") {
    return { schemaVersion: 1, root, status: "blocked", projectManifest: null, operations };
  }
  for (const path of managedDirectories.slice(1)) {
    operations.push(await planDirectory(root, path));
  }

  const projectPath = lervoRelativePaths.projectManifest;
  const existingProject = await readEntry(resolve(root, projectPath));
  let projectManifest: ProjectManifest | null = null;
  let desiredProjectManifest: ProjectManifest;
  if (existingProject.kind === "file") {
    try {
      projectManifest = parseAndValidateYaml<ProjectManifest>("project", existingProject.content);
      desiredProjectManifest = projectManifest;
    } catch {
      desiredProjectManifest = createDefaultManifest(options, root);
    }
  } else {
    desiredProjectManifest = createDefaultManifest(options, root);
  }

  const projectOperation = await planManagedFile({
    root,
    path: projectPath,
    desiredContent: serializeYaml(desiredProjectManifest),
    validateExisting: (content) => {
      projectManifest = parseAndValidateYaml<ProjectManifest>("project", content);
    },
  });
  operations.push(projectOperation);
  if (projectOperation.action === "create") {
    projectManifest = desiredProjectManifest;
  }

  operations.push(
    ...await planDocumentStorage(root),
    await planManagedFile({
      root,
      path: lervoRelativePaths.gitignore,
      desiredContent: "state/\n",
    }),
  );

  return {
    schemaVersion: 1,
    root,
    status: operations.some((operation) => operation.action === "conflict")
      ? "blocked"
      : "ready",
    projectManifest,
    operations,
  };
}
