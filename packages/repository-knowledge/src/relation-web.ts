import { historicalDocumentMarker } from "./historical-documents.js";
import { extractRelationDocument, relationContentHash } from "./relation-web-extraction.js";
import {
  commandNode,
  pathNode,
  RELATION_WEB_EXTRACTOR_VERSION,
  relationNodeParts,
  type RelationDocument,
  type RelationDocumentExtraction,
  type RelationEdge,
  type RelationLineageRecord,
  type RelationWorkspacePackage,
} from "./relation-web-model.js";

export interface RelationWebInput {
  documents: readonly { path: string; content: string; role: string }[];
  /** Every tracked file path; directories are derived. */
  trackedFiles: readonly string[];
  packages: readonly RelationWorkspacePackage[];
  /** The CLI command catalog, such as `lervo knowledge query`. */
  commands: readonly string[];
  lineage: readonly RelationLineageRecord[];
  archiveScopes: readonly string[];
  observedRevision: string | null;
}

export interface RelationWeb {
  extractorVersion: number;
  observedRevision: string | null;
  documents: ReadonlyMap<string, RelationDocument>;
  trackedFiles: ReadonlySet<string>;
  /** Directory path → number of tracked files below it. */
  directoryFileCounts: ReadonlyMap<string, number>;
  /** Package name → directory. */
  packages: ReadonlyMap<string, string>;
  /** Sorted command catalog. */
  commands: readonly string[];
  lineage: readonly RelationLineageRecord[];
  lineageEdges: readonly RelationEdge[];
  /** ADR number → the one document carrying it. */
  adrDocuments: ReadonlyMap<string, string>;
  /** ADR numbers carried by several documents; a bare mention of one resolves to none of them. */
  ambiguousAdrNumbers: ReadonlyMap<string, readonly string[]>;
  /** Named node → document edges that name it, with ADR and command names resolved. */
  inbound: ReadonlyMap<string, readonly RelationEdge[]>;
}

export interface RelationWebBuild {
  web: RelationWeb;
  /** Documents extracted in this build. */
  extracted: number;
  /** Documents whose previous extraction was reused by content hash and extractor version. */
  reused: number;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function directoryFileCounts(files: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const segments = file.split("/");
    for (let length = 1; length < segments.length; length++) {
      const directory = segments.slice(0, length).join("/");
      counts.set(directory, (counts.get(directory) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The catalog command a mention names: the longest catalog command its words start with, or the
 * mention itself when it is a command group that catalog commands start with. Null is unknown.
 */
function resolveRelationCommand(mention: string, commands: readonly string[]): string | null {
  let best: string | null = null;
  let group = false;
  for (const command of commands) {
    if (mention === command || mention.startsWith(`${command} `)) {
      if (best === null || command.length > best.length) best = command;
    } else if (command.startsWith(`${mention} `)) group = true;
  }
  return best ?? (group ? mention : null);
}

function lineageEdge(record: RelationLineageRecord): RelationEdge {
  return {
    kind: record.kind,
    from: pathNode(record.from),
    to: record.to === undefined ? pathNode(record.from) : pathNode(record.to),
    evidence: {
      extractorVersion: RELATION_WEB_EXTRACTOR_VERSION,
      sourceDocument: record.record,
      line: 0,
      strength: "lineage",
      observedRevision: null,
    },
  };
}

/**
 * The node an edge names from its declaring document's point of view: the target of an outgoing
 * edge, or the declaring end of an incoming header edge such as `Superseded by`.
 */
function relationEdgeNamedNode(edge: RelationEdge): string {
  return edge.to === pathNode(edge.evidence.sourceDocument) ? edge.from : edge.to;
}

function inboundIndex(
  documents: ReadonlyMap<string, RelationDocument>,
  adrDocuments: ReadonlyMap<string, string>,
  commands: readonly string[],
): Map<string, RelationEdge[]> {
  const inbound = new Map<string, RelationEdge[]>();
  const add = (node: string, edge: RelationEdge) => {
    const list = inbound.get(node);
    if (list === undefined) inbound.set(node, [edge]);
    else list.push(edge);
  };
  const resolvedCommands = new Map<string, string | null>();
  for (const document of documents.values())
    for (const edge of document.edges) {
      const named = relationEdgeNamedNode(edge);
      const { kind, key } = relationNodeParts(named);
      if (kind === "adr") {
        add(named, edge);
        const path = adrDocuments.get(key);
        if (path !== undefined) add(pathNode(path), edge);
      } else if (kind === "command") {
        if (!resolvedCommands.has(key))
          resolvedCommands.set(key, resolveRelationCommand(key, commands));
        add(commandNode(resolvedCommands.get(key) ?? key), edge);
      } else add(named, edge);
    }
  return inbound;
}

/**
 * ADR-0562: builds the relation web. A previous extraction is reused when its path, content hash,
 * and extractor version match, so an unchanged document is never extracted twice.
 */
export function buildRelationWeb(
  input: RelationWebInput,
  previous: ReadonlyMap<string, RelationDocumentExtraction> = new Map(),
): RelationWebBuild {
  let extracted = 0;
  let reused = 0;
  const documents: RelationDocument[] = [];
  for (const document of input.documents) {
    const prior = previous.get(document.path);
    let extraction: RelationDocumentExtraction;
    if (
      prior !== undefined &&
      prior.extractorVersion === RELATION_WEB_EXTRACTOR_VERSION &&
      prior.contentHash === relationContentHash(document.content)
    ) {
      extraction = prior;
      reused += 1;
    } else {
      extraction = extractRelationDocument({
        path: document.path,
        content: document.content,
        observedRevision: input.observedRevision,
      });
      extracted += 1;
    }
    documents.push({
      ...extraction,
      role: document.role,
      historical:
        historicalDocumentMarker({
          path: document.path,
          content: document.content,
          archiveScopes: input.archiveScopes,
        }) !== null,
    });
  }
  return { web: assembleRelationWeb({ ...input, documents }), extracted, reused };
}

/** The repository-wide parts of a web around classified documents, for builds and stored webs. */
export interface RelationWebParts {
  documents: readonly RelationDocument[];
  trackedFiles: readonly string[];
  packages: readonly RelationWorkspacePackage[];
  commands: readonly string[];
  lineage: readonly RelationLineageRecord[];
  observedRevision: string | null;
}

export function assembleRelationWeb(parts: RelationWebParts): RelationWeb {
  const documents = new Map(
    [...parts.documents]
      .sort((left, right) => compare(left.path, right.path))
      .map((document) => [document.path, document]),
  );
  const adrCarriers = new Map<string, string[]>();
  for (const document of documents.values())
    if (document.adr !== null)
      adrCarriers.set(document.adr, [...(adrCarriers.get(document.adr) ?? []), document.path]);
  const adrDocuments = new Map<string, string>();
  const ambiguousAdrNumbers = new Map<string, string[]>();
  for (const [number, paths] of adrCarriers)
    if (paths.length === 1) adrDocuments.set(number, paths[0]!);
    else ambiguousAdrNumbers.set(number, paths);
  const commands = [...new Set(parts.commands)].sort(compare);
  const lineage = [...parts.lineage].sort(
    (left, right) => compare(left.from, right.from) || compare(left.kind, right.kind),
  );
  return {
    extractorVersion: RELATION_WEB_EXTRACTOR_VERSION,
    observedRevision: parts.observedRevision,
    documents,
    trackedFiles: new Set(parts.trackedFiles),
    directoryFileCounts: directoryFileCounts(parts.trackedFiles),
    packages: new Map(parts.packages.map((item) => [item.name, item.directory])),
    commands,
    lineage,
    lineageEdges: lineage.map(lineageEdge),
    adrDocuments,
    ambiguousAdrNumbers,
    inbound: inboundIndex(documents, adrDocuments, commands),
  };
}

/** The document a node names: a document path, or the document carrying an ADR number. */
export function relationNodeDocument(web: RelationWeb, node: string): string | null {
  const { kind, key } = relationNodeParts(node);
  if (kind === "adr") return web.adrDocuments.get(key) ?? null;
  return kind === "path" && web.documents.has(key) ? key : null;
}
