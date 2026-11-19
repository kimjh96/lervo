import type { DocumentLifecycleEvidence } from "./document-lifecycle-model.js";
import type { DocumentLifecycleGitPort } from "./document-lifecycle-git.js";
import { resolveLifecycleReason } from "./document-lifecycle-resolution.js";
import { extractRelationDocument } from "./relation-web-extraction.js";
import {
  relationNodeParts,
  type RelationDocumentExtraction,
  type RelationWorkspacePackage,
} from "./relation-web-model.js";
import { relationSuspectsFor } from "./relation-web-suspects.js";
import type { RelationWeb } from "./relation-web.js";

const manifestPattern = /^(?:apps|packages)\/[^/]+\/package\.json$/u;
const markdownPattern = /\.mdx?$/iu;
const declarationKinds = new Set(["supersedes", "supersedes_part", "amends"]);

/** Documents assessed through the same baseline revision, evaluated with one diff. */
export interface DocumentLifecycleGroup {
  baseline: string;
  documents: readonly string[];
}

/** Reasons per document of a group, each already resolved deterministically where possible. */
export type DocumentLifecycleGroupResult = Map<string, DocumentLifecycleEvidence[]>;

/** Catalog command mentions in code that resolve to no catalog command or command group. */
export function unknownCatalogCommands(web: RelationWeb): string[] {
  if (web.commands.length === 0) return [];
  const known = new Set(web.commands);
  const unknown: string[] = [];
  for (const [node, edges] of web.inbound) {
    const { kind, key } = relationNodeParts(node);
    if (kind !== "command" || known.has(key)) continue;
    if (web.commands.some((command) => command.startsWith(`${key} `))) continue;
    if (edges.some((edge) => edge.evidence.strength === "strong")) unknown.push(key);
  }
  return unknown.sort();
}

async function previousExtractions(
  web: RelationWeb,
  git: DocumentLifecycleGitPort,
  baseline: string,
  changedPaths: readonly string[],
): Promise<Map<string, RelationDocumentExtraction>> {
  // Only a document that declares a header relation now can have declared it before.
  const declaring = changedPaths.filter(
    (path) =>
      markdownPattern.test(path) &&
      (web.documents
        .get(path)
        ?.edges.some(
          (edge) => declarationKinds.has(edge.kind) && edge.evidence.sourceDocument === path,
        ) ??
        false),
  );
  const blobs = await git.blobs(declaring.map((path) => `${baseline}:${path}`));
  const extractions = new Map<string, RelationDocumentExtraction>();
  for (const path of declaring) {
    const content = blobs.get(`${baseline}:${path}`);
    if (content !== null && content !== undefined)
      extractions.set(path, extractRelationDocument({ path, content, observedRevision: baseline }));
  }
  return extractions;
}

async function deletedPackages(
  git: DocumentLifecycleGitPort,
  baseline: string,
  deletedPaths: readonly string[],
): Promise<RelationWorkspacePackage[]> {
  const manifests = deletedPaths.filter((path) => manifestPattern.test(path));
  const blobs = await git.blobs(manifests.map((path) => `${baseline}:${path}`));
  const packages: RelationWorkspacePackage[] = [];
  for (const path of manifests) {
    try {
      const name = (JSON.parse(blobs.get(`${baseline}:${path}`) ?? "{}") as { name?: unknown })
        .name;
      if (typeof name === "string")
        packages.push({ name, directory: path.slice(0, -"/package.json".length) });
    } catch {
      // An unreadable deleted manifest names no package; its directory is still a removed path.
    }
  }
  return packages;
}

/**
 * ADR-0562: evaluates one group against HEAD. The relation web reverse lookup over the group's
 * diff yields the reasons; each is resolved deterministically before any provider spend. Changed
 * lines are read once per group, and document bytes only for documents with a changed path.
 */
export async function evaluateDocumentLifecycleGroup(input: {
  web: RelationWeb;
  git: DocumentLifecycleGitPort;
  head: string;
  group: DocumentLifecycleGroup;
  unknownCommands: readonly string[];
  readDocument: (path: string) => Promise<string | null>;
}): Promise<DocumentLifecycleGroupResult> {
  const { web, git, head, group } = input;
  const change = await git.changes(group.baseline, head);
  const suspects = relationSuspectsFor(web, {
    ...change,
    removedCommands: input.unknownCommands,
    previousExtractions: await previousExtractions(web, git, group.baseline, change.changedPaths),
    deletedPackages: await deletedPackages(git, group.baseline, change.deletedPaths),
  });
  const members = new Set(group.documents);
  const raw = suspects.suspects.filter((suspect) => members.has(suspect.document));
  const changed = new Set<string>();
  for (const suspect of raw)
    for (const reason of suspect.reasons)
      if (reason.reason === "path_changed")
        changed.add(reason.via ?? relationNodeParts(reason.target).key);
  let lines: Map<string, string[]> | null;
  try {
    lines = await git.changedLines(group.baseline, head, [...changed].sort());
  } catch {
    lines = null;
  }
  const result: DocumentLifecycleGroupResult = new Map();
  for (const suspect of raw) {
    const document = web.documents.get(suspect.document)!;
    // Header-only reasons need no bytes; every other reason reads the document once.
    const content = suspect.reasons.every(
      (reason) => reason.reason === "amended" || reason.reason === "superseded_in_part",
    )
      ? null
      : await input.readDocument(suspect.document);
    const resolved = suspect.reasons
      .map((evidence) =>
        resolveLifecycleReason({
          web,
          document,
          evidence,
          content,
          changedLines: (path) => lines?.get(path) ?? null,
        }),
      )
      .filter((evidence): evidence is DocumentLifecycleEvidence => evidence !== null);
    result.set(suspect.document, resolved);
  }
  return result;
}
