import {
  commandNode,
  packageNode,
  pathNode,
  type RelationEdge,
  type RelationEdgeKind,
  type RelationEdgeStrength,
  type RelationDocumentExtraction,
  type RelationWorkspacePackage,
} from "./relation-web-model.js";
import { relationNodeDocument, type RelationWeb } from "./relation-web.js";

/**
 * Why a document may no longer match the repository (ADR-0562):
 *
 * - `path_changed`: a non-Markdown path it names strongly changed, or a non-Markdown path changed
 *   below a directory it names strongly that is not a top-level directory.
 * - `path_removed`: a path or directory it names no longer exists.
 * - `package_removed`: an `@lervo/` package it names lost its directory.
 * - `command_removed`: a CLI command or command group it names left the catalog.
 * - `moved_target`: a path it names moved, split, or merged under a lineage record.
 * - `target_superseded` / `target_amended`: a document it names was superseded or amended by a
 *   header declaration that is new in a changed document.
 * - `superseded_in_part` / `amended`: a header declaration that is new in another changed document
 *   supersedes a named part of this document or amends it, so this document needs a reverse header
 *   line or a refresh.
 */
export type RelationSuspectReason =
  | "path_changed"
  | "path_removed"
  | "package_removed"
  | "command_removed"
  | "moved_target"
  | "target_superseded"
  | "target_amended"
  | "superseded_in_part"
  | "amended";

export interface RelationSuspectEvidence {
  reason: RelationSuspectReason;
  /** The named node: a path, package, command, or the superseding or amending document. */
  target: string;
  edgeKind: RelationEdgeKind;
  /** One-based line in the suspect document, or zero when the evidence is in `via`. */
  line: number;
  strength: RelationEdgeStrength;
  /** The changed path, lineage destination, or declaring document behind the reason. */
  via?: string;
  part?: string;
}

export interface RelationSuspect {
  document: string;
  reasons: RelationSuspectEvidence[];
}

export interface RelationChange {
  /** Paths whose bytes changed or that were added. */
  changedPaths: readonly string[];
  deletedPaths: readonly string[];
  /** Catalog commands that no longer exist; omitted when the previous catalog is unknown. */
  removedCommands?: readonly string[];
  /**
   * The extractions of changed documents before the change. A header declaration already present
   * there is not new, so it does not reach the documents it names again.
   */
  previousExtractions?: ReadonlyMap<string, RelationDocumentExtraction>;
  /** Packages whose manifests the change deleted, for a web built after the change. */
  deletedPackages?: readonly RelationWorkspacePackage[];
}

export interface RelationSuspectSet {
  suspects: RelationSuspect[];
  /** Documents a changed document's header supersedes in full: they become historical. */
  superseded: { document: string; by: string; line: number }[];
  removedDirectories: string[];
  removedPackages: string[];
  removedCommandGroups: string[];
}

const pathEdgeKinds = new Set<RelationEdgeKind>(["links_to", "names_path"]);
const markdownPattern = /\.mdx?$/iu;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function headerEdgeKey(edge: RelationEdge): string {
  return `${edge.kind}\u0000${edge.from}\u0000${edge.to}`;
}

function ancestors(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(1).map((_segment, index) => segments.slice(0, index + 1).join("/"));
}

function removedDirectories(web: RelationWeb, deleted: ReadonlySet<string>): Set<string> {
  const deletedBelow = new Map<string, number>();
  for (const path of deleted)
    if (web.trackedFiles.has(path))
      for (const directory of ancestors(path))
        deletedBelow.set(directory, (deletedBelow.get(directory) ?? 0) + 1);
  const removed = new Set<string>();
  for (const path of deleted)
    for (const directory of ancestors(path))
      if ((web.directoryFileCounts.get(directory) ?? 0) - (deletedBelow.get(directory) ?? 0) <= 0)
        removed.add(directory);
  return removed;
}

/** Command groups whose every catalog command was removed, such as `lervo loop`. */
function removedGroups(web: RelationWeb, removed: ReadonlySet<string>): string[] {
  const groups = new Set<string>();
  for (const command of removed) {
    const words = command.split(" ");
    for (let length = 2; length < words.length; length++) {
      const group = words.slice(0, length).join(" ");
      const members = web.commands.filter(
        (candidate) => candidate === group || candidate.startsWith(`${group} `),
      );
      if (members.length > 0 && members.every((member) => removed.has(member))) groups.add(group);
    }
  }
  return [...groups].sort(compare);
}

type Flag = (
  edge: RelationEdge,
  evidence: Omit<RelationSuspectEvidence, "line" | "strength">,
  document?: string,
) => void;

interface SuspectScope {
  web: RelationWeb;
  removedPaths: ReadonlySet<string>;
  flag: Flag;
}

function named(web: RelationWeb, node: string): readonly RelationEdge[] {
  return web.inbound.get(node) ?? [];
}

function flagRemovedPaths({ web, removedPaths, flag }: SuspectScope): void {
  const lineageFrom = new Map(web.lineage.map((record) => [record.from, record]));
  for (const path of removedPaths)
    for (const edge of named(web, pathNode(path))) {
      if (!pathEdgeKinds.has(edge.kind) && edge.evidence.strength !== "header") continue;
      const moved = lineageFrom.get(path);
      if (moved?.to !== undefined)
        flag(edge, {
          reason: "moved_target",
          target: pathNode(path),
          edgeKind: edge.kind,
          via: moved.to,
        });
      else flag(edge, { reason: "path_removed", target: pathNode(path), edgeKind: edge.kind });
    }
}

function flagChangedPaths({ web, removedPaths, flag }: SuspectScope, paths: string[]): void {
  // A changed document reaches the documents naming it through its header, not as a path change.
  // A top-level directory such as `packages/` names a repository area, not a changed part.
  const changedTargets = new Map<string, string>();
  for (const path of paths) {
    if (markdownPattern.test(path)) continue;
    if (!removedPaths.has(path)) changedTargets.set(path, path);
    for (const directory of ancestors(path).slice(1))
      if (!removedPaths.has(directory) && !changedTargets.has(directory))
        changedTargets.set(directory, path);
  }
  for (const [target, via] of changedTargets)
    for (const edge of named(web, pathNode(target)))
      if (
        pathEdgeKinds.has(edge.kind) &&
        edge.evidence.strength === "strong" &&
        edge.evidence.sourceDocument !== via
      )
        flag(edge, {
          reason: "path_changed",
          target: pathNode(target),
          edgeKind: edge.kind,
          ...(target === via ? {} : { via }),
        });
}

function flagRemovedPackages(
  { web, removedPaths, flag }: SuspectScope,
  deletedPackages: readonly RelationWorkspacePackage[],
): string[] {
  const packages = new Map([
    ...web.packages,
    ...deletedPackages.map((item) => [item.name, item.directory] as const),
  ]);
  const removed = [...packages]
    .filter(([, directory]) => removedPaths.has(directory))
    .map(([name]) => name)
    .sort(compare);
  for (const name of removed)
    for (const edge of named(web, packageNode(name)))
      flag(edge, { reason: "package_removed", target: packageNode(name), edgeKind: edge.kind });
  return removed;
}

function flagRemovedCommands({ web, flag }: SuspectScope, commands: readonly string[]): string[] {
  const removed = new Set(commands);
  const groups = removedGroups(web, removed);
  for (const command of [...removed, ...groups])
    for (const edge of named(web, commandNode(command)))
      flag(edge, { reason: "command_removed", target: commandNode(command), edgeKind: edge.kind });
  return groups;
}

/** Header declarations new in changed documents, and the documents that name their subjects. */
function closeOverHeaders(
  { web, flag }: SuspectScope,
  change: RelationChange,
): RelationSuspectSet["superseded"] {
  const superseded = new Map<string, { document: string; by: string; line: number }>();
  for (const path of change.changedPaths) {
    const declaring = web.documents.get(path);
    if (declaring === undefined) continue;
    const declaredBefore = new Set(
      (change.previousExtractions?.get(path)?.edges ?? []).map(headerEdgeKey),
    );
    for (const edge of declaring.edges) {
      if (edge.kind !== "supersedes" && edge.kind !== "supersedes_part" && edge.kind !== "amends")
        continue;
      if (declaredBefore.has(headerEdgeKey(edge))) continue;
      const subject = relationNodeDocument(web, edge.to);
      const by = relationNodeDocument(web, edge.from);
      if (subject === null || by === null || subject === by) continue;
      if (edge.kind === "supersedes") {
        if (!superseded.has(subject))
          superseded.set(subject, { document: subject, by, line: edge.evidence.line });
      } else if (subject !== path)
        flag(
          edge,
          {
            reason: edge.kind === "amends" ? "amended" : "superseded_in_part",
            target: pathNode(by),
            edgeKind: edge.kind,
            via: path,
            ...(edge.part === undefined ? {} : { part: edge.part }),
          },
          subject,
        );
      // A named part leaves the rest of the subject current, so only the subject is suspect.
      if (edge.kind === "supersedes_part") continue;
      const reason = edge.kind === "amends" ? "target_amended" : "target_superseded";
      for (const naming of named(web, pathNode(subject))) {
        const source = naming.evidence.sourceDocument;
        if (source === subject || source === by) continue;
        flag(naming, { reason, target: pathNode(subject), edgeKind: naming.kind, via: by });
      }
    }
  }
  return [...superseded.values()].sort((left, right) => compare(left.document, right.document));
}

/**
 * ADR-0562 reverse lookup: the documents a change may have made wrong, each with its reasons.
 * Historical documents are frozen records and deleted documents are gone, so neither is a suspect.
 */
export function relationSuspectsFor(web: RelationWeb, change: RelationChange): RelationSuspectSet {
  const deleted = new Set(change.deletedPaths);
  const removedDirectorySet = removedDirectories(web, deleted);
  const suspects = new Map<string, Map<string, RelationSuspectEvidence>>();
  const flag: Flag = (edge, evidence, document = edge.evidence.sourceDocument) => {
    const record = web.documents.get(document);
    if (record === undefined || record.historical || deleted.has(document)) return;
    const reasons = suspects.get(document) ?? new Map<string, RelationSuspectEvidence>();
    const key = `${evidence.reason}\u0000${evidence.target}`;
    if (!reasons.has(key))
      reasons.set(key, {
        ...evidence,
        line: document === edge.evidence.sourceDocument ? edge.evidence.line : 0,
        strength: edge.evidence.strength,
      });
    suspects.set(document, reasons);
  };
  const scope: SuspectScope = {
    web,
    removedPaths: new Set([...deleted, ...removedDirectorySet]),
    flag,
  };
  flagRemovedPaths(scope);
  flagChangedPaths(scope, [...change.changedPaths, ...deleted]);
  const removedPackages = flagRemovedPackages(scope, change.deletedPackages ?? []);
  const removedCommandGroups = flagRemovedCommands(scope, change.removedCommands ?? []);
  const superseded = closeOverHeaders(scope, change);
  return {
    suspects: [...suspects]
      .sort(([left], [right]) => compare(left, right))
      .map(([document, reasons]) => ({
        document,
        reasons: [...reasons.values()].sort(
          (left, right) => compare(left.reason, right.reason) || compare(left.target, right.target),
        ),
      })),
    superseded,
    removedDirectories: [...removedDirectorySet].sort(compare),
    removedPackages,
    removedCommandGroups,
  };
}
