import { posix } from "node:path";

import type {
  DocumentFreshnessArchivePlan,
  DocumentFreshnessLinkRewrite,
  DocumentFreshnessOwnership,
} from "./document-freshness-contract.js";
import { sha256 } from "./integrity.js";

const fencePattern = /^\s{0,3}(`{3,}|~{3,})(.*)$/u;
const inlineLinkPattern =
  /(!?\[(?:[^\]\\]|\\.)*\]\(\s*)(<[^>]*>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\))/gu;
const referenceDefinitionPattern = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)(.*)$/u;
const schemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const archiveName = /^[a-z0-9][a-z0-9-]{0,95}\.md$/u;

function splitDestination(raw: string): { path: string; suffix: string; angle: boolean } | null {
  const angle = raw.startsWith("<") && raw.endsWith(">");
  const target = angle ? raw.slice(1, -1) : raw;
  if (target === "" || target.startsWith("#") || target.startsWith("//")) return null;
  if (schemePattern.test(target)) return null;
  const index = target.search(/[?#]/u);
  return {
    path: index < 0 ? target : target.slice(0, index),
    suffix: index < 0 ? "" : target.slice(index),
    angle,
  };
}

function resolveTarget(documentPath: string, path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const joined = decoded.startsWith("/")
    ? decoded.slice(1)
    : posix.join(posix.dirname(documentPath), decoded);
  const normalized = posix.normalize(joined).replace(/\/$/u, "");
  return normalized === "." || normalized.startsWith("../") ? null : normalized;
}

function relativeLink(fromDocument: string, target: string): string {
  const relative = posix.relative(posix.dirname(fromDocument), target);
  return relative === "" ? posix.basename(target) : relative;
}

/**
 * Rewrites relative Markdown link destinations outside fenced code. `rewrite` receives the
 * repository path a destination resolves to and returns the new destination path, or null to keep
 * the bytes. Returns the new text and one record per rewritten destination.
 */
export function rewriteDocumentLinks(input: {
  documentPath: string;
  content: string;
  rewrite: (resolvedTarget: string) => string | null;
}): { content: string; rewrites: DocumentFreshnessLinkRewrite[] } {
  const rewrites: DocumentFreshnessLinkRewrite[] = [];
  const lines = input.content.split("\n");
  let fence: string | null = null;
  const replaceDestination = (raw: string, line: number): string => {
    const destination = splitDestination(raw);
    if (destination === null) return raw;
    const resolved = resolveTarget(input.documentPath, destination.path);
    if (resolved === null) return raw;
    const next = input.rewrite(resolved);
    if (next === null) return raw;
    const value = `${next}${destination.suffix}`;
    const replaced = destination.angle ? `<${value}>` : value;
    if (replaced !== raw)
      rewrites.push({ path: input.documentPath, line, from: raw, to: replaced });
    return replaced;
  };
  const output = lines.map((text, index) => {
    const fenceMatch = fencePattern.exec(text);
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1]!.startsWith(fence) && fenceMatch[2]!.trim() === "")
        fence = null;
      return text;
    }
    if (fenceMatch !== null) {
      fence = fenceMatch[1]!;
      return text;
    }
    const line = index + 1;
    const definition = referenceDefinitionPattern.exec(text);
    if (definition !== null)
      return `${definition[1]}${replaceDestination(definition[2]!, line)}${definition[3]}`;
    return text.replace(
      inlineLinkPattern,
      (_match, open: string, raw: string, close: string) =>
        `${open}${replaceDestination(raw, line)}${close}`,
    );
  });
  return { content: output.join("\n"), rewrites };
}

/** The archive target for a document: a provider-suggested name, else the source basename. */
export function documentFreshnessArchiveTarget(input: {
  documentPath: string;
  historicalRoot: string;
  suggestedName: string | null;
}): string {
  const fallback = posix
    .basename(input.documentPath)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, "-")
    .replace(/^-+/u, "");
  const name =
    input.suggestedName !== null && archiveName.test(input.suggestedName)
      ? input.suggestedName
      : archiveName.test(fallback)
        ? fallback
        : "archived-document.md";
  return posix.join(input.historicalRoot, name);
}

/** The historical banner ADR-0464 recognizes, naming the archive date and the current document. */
export function documentFreshnessArchiveBanner(input: {
  targetPath: string;
  archivedOn: string;
  currentDocumentPath: string | null;
}): string {
  const current =
    input.currentDocumentPath === null
      ? "It is kept for history and does not describe the current design."
      : `The current document is [${input.currentDocumentPath}](${relativeLink(
          input.targetPath,
          input.currentDocumentPath,
        )}).`;
  return `> Historical: archived on ${input.archivedOn}. ${current}\n\n`;
}

/**
 * Plans an archive move: the banner, the archived document's own relative links rebased to the
 * new directory, and every inbound link rewritten to the new location. No other byte changes.
 */
export function planDocumentFreshnessArchive(input: {
  documentPath: string;
  content: string;
  historicalRoot: string;
  suggestedName: string | null;
  currentDocumentPath: string | null;
  archivedOn: string;
  ownership: DocumentFreshnessOwnership;
  inboundDocuments: readonly { path: string; content: string }[];
}): DocumentFreshnessArchivePlan {
  const targetPath = documentFreshnessArchiveTarget(input);
  const outgoing = rewriteDocumentLinks({
    documentPath: input.documentPath,
    content: input.content,
    rewrite: (resolved) => relativeLink(targetPath, resolved),
  });
  const inbound: DocumentFreshnessLinkRewrite[] = [];
  const inboundSourceHashes: Record<string, string> = {};
  for (const document of [...input.inboundDocuments].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    if (document.path === input.documentPath) continue;
    const rewritten = rewriteDocumentLinks({
      documentPath: document.path,
      content: document.content,
      rewrite: (resolved) =>
        resolved === input.documentPath ? relativeLink(document.path, targetPath) : null,
    });
    if (rewritten.rewrites.length === 0) continue;
    inbound.push(...rewritten.rewrites);
    inboundSourceHashes[document.path] = sha256(document.content);
  }
  return {
    targetPath,
    banner: documentFreshnessArchiveBanner({
      targetPath,
      archivedOn: input.archivedOn,
      currentDocumentPath: input.currentDocumentPath,
    }),
    inboundLinkRewrites: inbound,
    outgoingLinkRewrites: outgoing.rewrites,
    ownership: input.ownership,
    inboundSourceHashes,
  };
}

/** Bytes an archive plan writes: the moved document and each rewritten inbound document. */
export function applyDocumentFreshnessArchive(input: {
  plan: DocumentFreshnessArchivePlan;
  documentPath: string;
  content: string;
  inboundDocuments: readonly { path: string; content: string }[];
}): { targetContent: string; inbound: Array<{ path: string; content: string }> } {
  const { plan } = input;
  const moved = rewriteDocumentLinks({
    documentPath: input.documentPath,
    content: input.content,
    rewrite: (resolved) => relativeLink(plan.targetPath, resolved),
  }).content;
  const inbound = input.inboundDocuments
    .filter((document) => plan.inboundSourceHashes[document.path] !== undefined)
    .map((document) => ({
      path: document.path,
      content: rewriteDocumentLinks({
        documentPath: document.path,
        content: document.content,
        rewrite: (resolved) =>
          resolved === input.documentPath ? relativeLink(document.path, plan.targetPath) : null,
      }).content,
    }));
  return { targetContent: `${plan.banner}${moved}`, inbound };
}
