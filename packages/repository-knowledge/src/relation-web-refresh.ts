import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  defaultDecisionTaxonomy,
  LervoProjectError,
  loadDecisionTaxonomy,
  loadProjectManifest,
  type DecisionTaxonomy,
} from "@lervo/project";

import { archiveScopes } from "./historical-documents.js";
import type { RelationLineageRecord, RelationWorkspacePackage } from "./relation-web-model.js";
import {
  readRelationWebStore,
  RELATION_WEB_STATE_PATH,
  writeRelationWebStore,
} from "./relation-web-store.js";
import { buildRelationWeb, type RelationWeb } from "./relation-web.js";
import { repositoryScanPriority } from "./scan-priority.js";
import { loadDocumentMoveLineages } from "./source-lineage.js";

const execute = promisify(execFile);
const MAXIMUM_DOCUMENT_BYTES = 1024 * 1024;
const manifestPattern = /^(?:apps|packages)\/[^/]+\/package\.json$/u;

/**
 * The outcome of one relation web refresh (ADR-0562).
 *
 * - `current`: the web was rebuilt from the checkout; `extracted` documents were read again and
 *   `reused` kept their extraction by content hash. `previous` is the web stored before it.
 * - `stale` (`relation_web_stale`): the build or the store write failed. The previous stored web,
 *   if any, stays in place and is returned; `message` carries no document text.
 */
export type RelationWebRefresh =
  | {
      status: "current";
      web: RelationWeb;
      previous: RelationWeb | null;
      extracted: number;
      reused: number;
      durationMs: number;
    }
  | {
      status: "stale";
      code: "relation_web_stale";
      message: string;
      web: RelationWeb | null;
    };

/** Tracked and untracked, not ignored, files; private state is never a relation target. */
export async function repositoryTrackedFiles(root: string): Promise<string[]> {
  const { stdout } = await execute(
    "git",
    [
      "-C",
      root,
      "-c",
      "core.quotePath=false",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
  );
  return [
    ...new Set(
      stdout.split("\0").filter((path) => path.length > 0 && !path.startsWith(".lervo/state/")),
    ),
  ];
}

async function headRevision(root: string): Promise<string | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      timeout: 10_000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** An uninitialized checkout has no tracked layout yet; an invalid one is a failure. */
async function decisionTaxonomy(root: string): Promise<DecisionTaxonomy> {
  try {
    return await loadDecisionTaxonomy(root);
  } catch (error) {
    if (error instanceof LervoProjectError && error.code === "not_initialized")
      return defaultDecisionTaxonomy;
    throw error;
  }
}

async function readDocuments(root: string, files: readonly string[]) {
  const taxonomy = await decisionTaxonomy(root);
  const markdown = files.filter((path) => /\.mdx?$/iu.test(path) && !path.startsWith(".lervo/"));
  const documents = await Promise.all(
    markdown.map(async (path) => {
      const file = resolve(root, path);
      const info = await stat(file).catch(() => null);
      if (info === null || !info.isFile() || info.size > MAXIMUM_DOCUMENT_BYTES) return null;
      return {
        path,
        content: await readFile(file, "utf8"),
        role: repositoryScanPriority(path, taxonomy),
      };
    }),
  );
  return {
    documents: documents.filter((item): item is NonNullable<typeof item> => item !== null),
    archiveScopes: archiveScopes(taxonomy),
  };
}

async function workspacePackages(
  root: string,
  files: readonly string[],
): Promise<RelationWorkspacePackage[]> {
  const packages = await Promise.all(
    files
      .filter((path) => manifestPattern.test(path))
      .map(async (path) => {
        try {
          const name = (
            JSON.parse(await readFile(resolve(root, path), "utf8")) as { name?: unknown }
          ).name;
          return typeof name === "string"
            ? { name, directory: path.slice(0, -"/package.json".length) }
            : null;
        } catch {
          return null;
        }
      }),
  );
  return packages.filter((item): item is RelationWorkspacePackage => item !== null);
}

/**
 * Reviewed document moves, splits, and merges. A deleted or merged move closure retires or
 * redirects the moved path; a split record keeps its source and names one destination.
 */
async function lineage(root: string): Promise<RelationLineageRecord[]> {
  let projectId: string | undefined;
  try {
    projectId = (await loadProjectManifest(root)).projectId;
  } catch {
    return [];
  }
  if (projectId === undefined) return [];
  const { records, structure } = await loadDocumentMoveLineages({
    repositoryRoot: root,
    projectId,
  });
  const moves = records.flatMap(({ file, value }): RelationLineageRecord[] => {
    const moved: RelationLineageRecord = {
      kind: "moved_to",
      from: value.fromPath,
      to: value.toPath,
      record: file,
    };
    if (value.closure?.kind === "document_deleted")
      return [moved, { kind: "retired", from: value.toPath, record: file }];
    if (value.closure?.kind === "document_merged")
      return [
        moved,
        {
          kind: "merged_into",
          from: value.toPath,
          to: value.closure.destinationPath,
          record: file,
        },
      ];
    return [moved];
  });
  return [
    ...moves,
    ...structure.map((item): RelationLineageRecord => ({
      kind: item.kind,
      from: item.sourcePath,
      to: item.destinationPath,
      record: item.file,
    })),
  ];
}

/** The private store path; the state directory is created with mode 0700 and never followed. */
export async function relationWebStorePath(root: string): Promise<string> {
  const directory = resolve(root, ".lervo/state");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Unsafe Lervo state directory.");
  return resolve(root, RELATION_WEB_STATE_PATH);
}

export interface RelationWebBuildResult {
  web: RelationWeb;
  previous: RelationWeb | null;
  extracted: number;
  reused: number;
}

/**
 * ADR-0562: builds the relation web of one checkout without writing it. Documents whose bytes are
 * unchanged keep their stored extraction. `commands` is the CLI command catalog; `"stored"` keeps
 * the catalog of the stored web, because only the CLI knows its own usage text.
 */
export async function buildRepositoryRelationWeb(
  root: string,
  input: { commands: readonly string[] | "stored" },
): Promise<RelationWebBuildResult> {
  const files = await repositoryTrackedFiles(root);
  const [{ documents, archiveScopes: scopes }, packages, lineageRecords, revision] =
    await Promise.all([
      readDocuments(root, files),
      workspacePackages(root, files),
      lineage(root),
      headRevision(root),
    ]);
  // Reading never creates the state directory, so a read-only caller writes nothing.
  const previous = readRelationWebStore(resolve(root, RELATION_WEB_STATE_PATH));
  const build = buildRelationWeb(
    {
      documents,
      trackedFiles: files,
      packages,
      commands: input.commands === "stored" ? (previous?.commands ?? []) : input.commands,
      lineage: lineageRecords,
      archiveScopes: scopes,
      observedRevision: revision,
    },
    previous?.documents,
  );
  return { web: build.web, previous, extracted: build.extracted, reused: build.reused };
}

/**
 * Rebuilds and stores the web, keeping the stored document lifecycle rows of documents that still
 * exist. `durationMs` covers reading, extraction, and the store write.
 */
export async function refreshRelationWeb(
  root: string,
  input: { commands: readonly string[] | "stored"; now: Date; clock?: () => number },
): Promise<RelationWebRefresh> {
  let path: string | null = null;
  try {
    const clock = input.clock ?? (() => performance.now());
    const started = clock();
    path = await relationWebStorePath(root);
    const build = await buildRepositoryRelationWeb(root, input);
    writeRelationWebStore(path, build.web, input.now.toISOString(), "keep");
    return {
      status: "current",
      web: build.web,
      previous: build.previous,
      extracted: build.extracted,
      reused: build.reused,
      durationMs: Math.round(clock() - started),
    };
  } catch (error) {
    return {
      status: "stale",
      code: "relation_web_stale",
      message: error instanceof Error ? error.message : String(error),
      web: path === null ? null : readRelationWebStore(path),
    };
  }
}
