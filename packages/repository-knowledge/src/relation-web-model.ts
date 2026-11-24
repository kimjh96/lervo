/**
 * ADR-0562 relation web model. The web is a private, rebuildable projection of Markdown,
 * repository paths, workspace packages, CLI commands, and lineage records; it is never canonical.
 *
 * Node identities are strings with a kind prefix:
 *
 * - `path:<repository path>`: a tracked file or directory; a document is the path of its file.
 * - `adr:<NNNN>`: an ADR number, an alias of the document whose title or file name carries it.
 * - `package:<name>`: a workspace package name such as `@lervo/cli`, mapped to its directory.
 * - `command:<words>`: a CLI command mention such as `lervo knowledge query`, resolved against the
 *   command catalog when the web is indexed, so extraction stays a function of document bytes.
 *
 * Owner rules, turns, and stops are later node kinds; the prefix scheme admits them without a
 * schema change.
 */
export type RelationNodeKind = "document" | "adr" | "path" | "package" | "command" | "rule";

export type RelationEdgeKind =
  | "links_to"
  | "names_path"
  | "names_package"
  | "names_command"
  | "names_adr"
  | "amends"
  | "supersedes"
  | "supersedes_part"
  | "part_of"
  | "related"
  | "moved_to"
  | "split_into"
  | "merged_into"
  | "retired";

/**
 * `strong`: an unambiguous name (a link, a path with an extension or trailing slash, a code or fence
 * mention). `weak`: a plausible name (an extension-less path, a prose command, a bare ADR number).
 * `header`: an ADR header grammar declaration. `lineage`: a reviewed structure lineage record.
 */
export type RelationEdgeStrength = "strong" | "weak" | "header" | "lineage";

export interface RelationEdgeEvidence {
  extractorVersion: number;
  /** The document whose bytes declare the edge, or the lineage record path for lineage edges. */
  sourceDocument: string;
  /** One-based line in `sourceDocument`; zero for lineage edges. */
  line: number;
  strength: RelationEdgeStrength;
  /**
   * The checked-out revision when the declaring bytes were extracted, or null outside Git. The
   * bytes may include uncommitted edits; the content hash binds them exactly.
   */
  observedRevision: string | null;
}

export interface RelationEdge {
  kind: RelationEdgeKind;
  from: string;
  to: string;
  evidence: RelationEdgeEvidence;
  /** The named part of a `supersedes_part` edge. */
  part?: string;
}

/**
 * Version 1: references, ADR header grammar, package, command, and ADR name mentions. Version 2: a
 * strong mention after a weak one of the same target keeps the strong evidence.
 */
export const RELATION_WEB_EXTRACTOR_VERSION = 2;

/** Edges one document may declare; a document at the bound is recorded as truncated. */
export const MAXIMUM_DOCUMENT_RELATION_EDGES = 1024;

/** The extraction of one document; it depends only on path, bytes, and extractor version. */
export interface RelationDocumentExtraction {
  path: string;
  contentHash: string;
  extractorVersion: number;
  observedRevision: string | null;
  /** The ADR number this document carries, from its title or decision file name. */
  adr: string | null;
  /** The lowercase first token of the header `Status:` line. */
  status: string | null;
  truncated: boolean;
  edges: RelationEdge[];
}

/** A document of the web: its extraction plus repository-dependent classification. */
export interface RelationDocument extends RelationDocumentExtraction {
  /** The repository scan role, such as `canonical_documents`; supplied by the caller. */
  role: string;
  /** A frozen record (archive scope, front matter, banner, or historical status line). */
  historical: boolean;
}

export type RelationLineageKind = "moved_to" | "split_into" | "merged_into" | "retired";

/** One reviewed lineage fact from `.lervo/knowledge/source-lineage`. */
export interface RelationLineageRecord {
  kind: RelationLineageKind;
  from: string;
  /** The destination path; absent for `retired`. */
  to?: string;
  /** The lineage record file. */
  record: string;
}

export interface RelationWorkspacePackage {
  name: string;
  directory: string;
}

export function pathNode(path: string): string {
  return `path:${path}`;
}

export function adrNode(number: string): string {
  return `adr:${number}`;
}

export function packageNode(name: string): string {
  return `package:${name}`;
}

export function commandNode(words: string): string {
  return `command:${words}`;
}

/** The node kind and key of a node identity. */
export function relationNodeParts(node: string): { kind: string; key: string } {
  const index = node.indexOf(":");
  return { kind: node.slice(0, index), key: node.slice(index + 1) };
}
