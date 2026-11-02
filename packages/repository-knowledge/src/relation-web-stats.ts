import type {
  RelationEdgeKind,
  RelationEdgeStrength,
  RelationNodeKind,
} from "./relation-web-model.js";
import { relationNodeParts } from "./relation-web-model.js";
import type { RelationWeb } from "./relation-web.js";

export interface RelationWebStats {
  extractorVersion: number;
  observedRevision: string | null;
  documents: number;
  historicalDocuments: number;
  truncatedDocuments: number;
  nodes: Record<RelationNodeKind | "directory", number>;
  edges: number;
  edgesByKind: Partial<Record<RelationEdgeKind, Partial<Record<RelationEdgeStrength, number>>>>;
  /** Command mentions that resolve to no catalog command or group. */
  unresolvedCommandMentions: number;
  /** Bare or header ADR numbers that no document carries. */
  unresolvedAdrNumbers: number;
  /** ADR numbers that several documents carry; their bare mentions resolve to none. */
  ambiguousAdrNumbers: number;
}

/** Generated owner rules are documents with rule identity (ADR-0562 `scoped_to` comes later). */
const rulePrefix = "docs/instructions/generated/";

export function relationWebStats(web: RelationWeb): RelationWebStats {
  const edgesByKind: RelationWebStats["edgesByKind"] = {};
  let edges = 0;
  const countEdge = (kind: RelationEdgeKind, strength: RelationEdgeStrength) => {
    const byStrength = (edgesByKind[kind] ??= {});
    byStrength[strength] = (byStrength[strength] ?? 0) + 1;
    edges += 1;
  };
  const packages = new Set<string>(web.packages.keys());
  const commands = new Set<string>(web.commands);
  const adrNumbers = new Set<string>(web.adrDocuments.keys());
  const unresolvedAdr = new Set<string>();
  const unresolvedCommands = new Set<string>();
  let historical = 0;
  let truncated = 0;
  let rules = 0;
  for (const document of web.documents.values()) {
    if (document.historical) historical += 1;
    if (document.truncated) truncated += 1;
    if (document.path.startsWith(rulePrefix)) rules += 1;
    for (const edge of document.edges) countEdge(edge.kind, edge.evidence.strength);
  }
  for (const [node, list] of web.inbound) {
    const { kind, key } = relationNodeParts(node);
    if (kind === "package") packages.add(key);
    else if (kind === "adr" && !web.adrDocuments.has(key) && !web.ambiguousAdrNumbers.has(key))
      unresolvedAdr.add(key);
    else if (kind === "command") {
      if (web.commands.includes(key)) continue;
      // A group mention is indexed under itself; a mention without any catalog prefix is unknown.
      if (web.commands.some((command) => command.startsWith(`${key} `))) commands.add(key);
      else
        for (const edge of list) unresolvedCommands.add(`${edge.evidence.sourceDocument}\0${key}`);
    }
  }
  for (const edge of web.lineageEdges) countEdge(edge.kind, edge.evidence.strength);
  return {
    extractorVersion: web.extractorVersion,
    observedRevision: web.observedRevision,
    documents: web.documents.size,
    historicalDocuments: historical,
    truncatedDocuments: truncated,
    nodes: {
      document: web.documents.size - rules,
      rule: rules,
      adr: adrNumbers.size + web.ambiguousAdrNumbers.size + unresolvedAdr.size,
      path: web.trackedFiles.size,
      directory: web.directoryFileCounts.size,
      package: packages.size,
      command: commands.size,
    },
    edges,
    edgesByKind,
    unresolvedCommandMentions: unresolvedCommands.size,
    unresolvedAdrNumbers: unresolvedAdr.size,
    ambiguousAdrNumbers: web.ambiguousAdrNumbers.size,
  };
}
