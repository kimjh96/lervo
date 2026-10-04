import { resolve } from "node:path";

import type { ProjectManifest } from "@lervo/schemas";
import { parse } from "yaml";

import { createDefaultManifest, parseAndValidateYaml, serializeYaml } from "./config.js";
import { serializeDecisionTaxonomy, validateDecisionTaxonomy } from "./decision-taxonomy.js";
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

const managedDirectories = [lervoRelativePaths.root, lervoRelativePaths.knowledge] as const;
const rebuildableKnowledgeIgnore = [
  "# lervo:begin rebuildable-knowledge schema=1",
  "docs/knowledge/",
  "# lervo:end rebuildable-knowledge",
  "",
].join("\n");

function validateKnowledgePolicyContent(content: string): void {
  let value: unknown;
  try {
    value = parse(content);
  } catch {
    throw new LervoProjectError(
      "invalid_yaml",
      ".lervo/knowledge/policy.yaml must contain valid YAML.",
    );
  }
  const policy = value as {
    schemaVersion?: unknown;
    policyId?: unknown;
    publicationRoot?: unknown;
    publication?: Record<string, unknown>;
    exclude?: unknown;
    limits?: Record<string, unknown>;
  } | null;
  if (
    policy === null ||
    typeof policy !== "object" ||
    policy.schemaVersion !== 1 ||
    typeof policy.policyId !== "string" ||
    typeof policy.publicationRoot !== "string" ||
    !Array.isArray(policy.exclude) ||
    !policy.exclude.every((item) => typeof item === "string") ||
    (policy.publication !== undefined &&
      (policy.publication.language !== "en" ||
        !Number.isSafeInteger(policy.publication.maxNavigationEntries) ||
        !Number.isSafeInteger(policy.publication.maxNavigationBytes))) ||
    policy.limits === undefined ||
    !Number.isSafeInteger(policy.limits.maxFiles) ||
    !Number.isSafeInteger(policy.limits.maxFileBytes) ||
    !Number.isSafeInteger(policy.limits.maxTotalBytes)
  ) {
    throw new LervoProjectError(
      "contract_invalid",
      ".lervo/knowledge/policy.yaml does not satisfy the repository knowledge policy contract.",
    );
  }
}

function validateDecisionTaxonomyContent(content: string): void {
  let value: unknown;
  try {
    value = parse(content);
  } catch {
    throw new LervoProjectError(
      "invalid_yaml",
      ".lervo/knowledge/document-layout.yaml must contain valid YAML.",
    );
  }
  validateDecisionTaxonomy(value);
}

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
    reason: `A directory cannot be created at ${path}. The existing ${entry.kind === "file" ? "file" : entry.description} was preserved.`,
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
    const description = entry.kind === "directory" ? "directory" : entry.description;
    return {
      kind: "file",
      path: input.path,
      action: "conflict",
      reason: `The existing ${description} at ${input.path} will not be overwritten.`,
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

async function planRootGitignore(root: string): Promise<InitFileOperation> {
  const entry = await readEntry(resolve(root, ".gitignore"));
  if (entry.kind === "missing")
    return {
      kind: "file",
      path: ".gitignore",
      action: "create",
      content: rebuildableKnowledgeIgnore,
    };
  if (entry.kind === "file")
    return {
      kind: "file",
      path: ".gitignore",
      action: "unchanged",
      expectedContentHash: contentHash(entry.content),
    };
  return {
    kind: "file",
    path: ".gitignore",
    action: "conflict",
    reason: "The existing .gitignore entry is not a safe regular file.",
  };
}

export async function createInitPlan(options: CreateInitPlanOptions): Promise<InitPlan> {
  const root = resolve(options.root);
  const rootEntry = await readEntry(root);
  if (rootEntry.kind !== "directory") {
    throw new LervoProjectError(
      "unsafe_path",
      `The initialization target ${root} must be an existing directory.`,
    );
  }

  const previousBrandRoot = await readEntry(resolve(root, previousBrandRelativePaths.root));
  if (previousBrandRoot.kind !== "missing") {
    return {
      schemaVersion: 1,
      root,
      status: "blocked",
      projectManifest: null,
      operations: [
        {
          kind: "directory",
          path: lervoRelativePaths.root,
          action: "conflict",
          reason: `The ${previousBrandRelativePaths.root} path from the previous product name exists. Lervo will neither convert it automatically nor use it alongside ${lervoRelativePaths.root}. Preserve the existing state and use the explicit brand migration.`,
        },
      ],
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
    await planRootGitignore(root),
    await planManagedFile({
      root,
      path: lervoRelativePaths.knowledgePolicy,
      desiredContent: [
        "schemaVersion: 1",
        "policyId: knowledge.default",
        "publicationRoot: docs/knowledge",
        "publication:",
        "  language: en",
        "  maxNavigationEntries: 24",
        "  maxNavigationBytes: 8192",
        "normalization:",
        "  exclude: []",
        "exclude:",
        "  - .git/**",
        "  - .lervo/**",
        "  - .changes/**",
        "  - .venv/**",
        "  - '**/.venv/**'",
        "  - venv/**",
        "  - '**/venv/**'",
        "  - node_modules/**",
        "  - '**/node_modules/**'",
        "  - dist/**",
        "  - '**/dist/**'",
        "  - build/**",
        "  - '**/build/**'",
        "  - coverage/**",
        "  - '**/coverage/**'",
        "  - .next/**",
        "  - '**/.next/**'",
        "  - .turbo/**",
        "  - '**/.turbo/**'",
        "  - .expo/**",
        "  - '**/.expo/**'",
        "  - .gradle/**",
        "  - '**/.gradle/**'",
        "  - .cxx/**",
        "  - '**/.cxx/**'",
        "  - Pods/**",
        "  - '**/Pods/**'",
        "  - build-device/**",
        "  - '**/build-device/**'",
        "  - vendor/**",
        "  - '**/vendor/**'",
        "  - apps/node-runtime-dependencies/**",
        "  - apps/hub-runtime-dependencies/**",
        "limits:",
        "  maxFiles: 20000",
        "  maxFileBytes: 1048576",
        "  maxTotalBytes: 67108864",
        "",
      ].join("\n"),
      validateExisting: validateKnowledgePolicyContent,
    }),
    await planManagedFile({
      root,
      path: lervoRelativePaths.knowledgeDocumentLayout,
      desiredContent: serializeDecisionTaxonomy(),
      validateExisting: validateDecisionTaxonomyContent,
    }),
    ...(await planDocumentStorage(root)),
    await planManagedFile({
      root,
      path: lervoRelativePaths.gitignore,
      desiredContent: "data/\nstate/\nknowledge/convergence-delegation.json\n",
    }),
  );

  return {
    schemaVersion: 1,
    root,
    status: operations.some((operation) => operation.action === "conflict") ? "blocked" : "ready",
    projectManifest,
    operations,
  };
}
