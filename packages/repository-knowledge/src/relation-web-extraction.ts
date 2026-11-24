import { createHash } from "node:crypto";

import { parseDocumentHeader, type DocumentHeaderTarget } from "./document-header-grammar.js";
import { extractDocumentReferences, MAXIMUM_DOCUMENT_REFERENCES } from "./document-references.js";
import {
  adrNode,
  commandNode,
  MAXIMUM_DOCUMENT_RELATION_EDGES,
  packageNode,
  pathNode,
  RELATION_WEB_EXTRACTOR_VERSION,
  type RelationDocumentExtraction,
  type RelationEdge,
  type RelationEdgeKind,
  type RelationEdgeStrength,
} from "./relation-web-model.js";
import { extractRelationMentions } from "./relation-web-mentions.js";

const titleAdrPattern = /^#\s+ADR-(\d{3,5})\b/u;
const decisionFilePattern = /(?:^|\/)(?:decisions|adr)\/(?:.+\/)?(\d{4})-[^/]+\.mdx?$/iu;

export function relationContentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** The ADR number of a document: its `# ADR-NNNN` title, or a `NNNN-` decision file name. */
function documentAdr(path: string, content: string): string | null {
  const title = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u, 80)
    .find((line) => line.startsWith("# "));
  const number =
    (title === undefined ? undefined : titleAdrPattern.exec(title)?.[1]) ??
    decisionFilePattern.exec(path)?.[1];
  return number === undefined ? null : number.padStart(4, "0");
}

function headerNodes(self: string, item: DocumentHeaderTarget): { from: string; to: string } {
  const target =
    item.target.kind === "path" ? pathNode(item.target.path) : adrNode(item.target.number);
  return item.direction === "outgoing" ? { from: self, to: target } : { from: target, to: self };
}

/**
 * ADR-0562: one extraction pass over one document. The result depends only on the path, the bytes,
 * and `RELATION_WEB_EXTRACTOR_VERSION`, so it is reused while the content hash is unchanged.
 *
 * Markdown links become `links_to`; code paths, path symbols, and fence paths become `names_path`
 * (strong or weak as the reference extractor decides); header grammar targets become header edges;
 * `@lervo/` names, `lervo` commands, and bare ADR numbers become name edges.
 */
export function extractRelationDocument(input: {
  path: string;
  content: string;
  observedRevision: string | null;
}): RelationDocumentExtraction {
  const self = pathNode(input.path);
  const adr = documentAdr(input.path, input.content);
  const edges = new Map<string, RelationEdge>();
  let truncated = false;
  const add = (
    kind: RelationEdgeKind,
    from: string,
    to: string,
    line: number,
    strength: RelationEdgeStrength,
    part?: string,
  ) => {
    if (from === to) return;
    const key = `${kind}\u0000${from}\u0000${to}`;
    const existing = edges.get(key);
    if (existing !== undefined) {
      // A strong mention after a weak one of the same target keeps the strong evidence.
      if (existing.evidence.strength === "weak" && strength === "strong")
        edges.set(key, { ...existing, evidence: { ...existing.evidence, line, strength } });
      return;
    }
    if (edges.size >= MAXIMUM_DOCUMENT_RELATION_EDGES) {
      truncated = true;
      return;
    }
    edges.set(key, {
      kind,
      from,
      to,
      evidence: {
        extractorVersion: RELATION_WEB_EXTRACTOR_VERSION,
        sourceDocument: input.path,
        line,
        strength,
        observedRevision: input.observedRevision,
      },
      ...(part === undefined ? {} : { part }),
    });
  };
  const references = extractDocumentReferences({ path: input.path, content: input.content });
  if (references.length >= MAXIMUM_DOCUMENT_REFERENCES) truncated = true;
  for (const reference of references)
    add(
      reference.kind === "markdown_link" ? "links_to" : "names_path",
      self,
      pathNode(reference.target),
      reference.line,
      reference.weak === true ? "weak" : "strong",
    );
  const header = parseDocumentHeader({ path: input.path, content: input.content });
  const declaredAdrs = new Set<string>();
  for (const item of header.targets) {
    if (item.target.kind === "adr") declaredAdrs.add(item.target.number);
    const nodes = headerNodes(self, item);
    add(item.relation, nodes.from, nodes.to, item.line, "header", item.part);
  }
  for (const mention of extractRelationMentions(input.content)) {
    if (mention.kind === "package")
      add("names_package", self, packageNode(mention.name), mention.line, "strong");
    else if (mention.kind === "command")
      add(
        "names_command",
        self,
        commandNode(mention.name),
        mention.line,
        mention.strong ? "strong" : "weak",
      );
    else if (mention.name !== adr && !declaredAdrs.has(mention.name))
      add("names_adr", self, adrNode(mention.name), mention.line, "weak");
  }
  return {
    path: input.path,
    contentHash: relationContentHash(input.content),
    extractorVersion: RELATION_WEB_EXTRACTOR_VERSION,
    observedRevision: input.observedRevision,
    adr,
    status: header.status,
    truncated,
    edges: [...edges.values()],
  };
}
