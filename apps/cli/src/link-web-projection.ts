import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { loadDecisionTaxonomy } from "@lervo/project";
import {
  archiveScopes,
  buildDocumentLinkWeb,
  buildGoverningIndex,
  repositoryScanPriority,
} from "@lervo/repository-knowledge";

import { readPrivateStateJson, writePrivateStateJson } from "./private-state-file.js";
import { governingIndexPresent, writeGoverningIndex } from "./turn-governance.js";

const execute = promisify(execFile);
const STATE = "link-web.json";
const SAMPLE = 16;
const MAXIMUM_DOCUMENT_BYTES = 1024 * 1024;
const REOBSERVE_MS = 60 * 60_000;

export interface LinkWebSummary {
  schemaVersion: 1;
  observedAt: string;
  /** Digest of tracked Markdown paths, sizes, and modification times; unchanged means reusable. */
  inputDigest: string;
  documentCount: number;
  linkCount: number;
  brokenCount: number;
  orphanCount: number;
  missingBacklinkCount: number;
  /** Documents whose links reached the extraction bound; counts may be low. */
  truncatedCount?: number;
  broken: { path: string; line: number; target: string }[];
  orphans: string[];
  missingBacklinks: { path: string; target: string }[];
}

/** Tracked and untracked, not ignored, files; private state is excluded. */
export async function trackedFiles(root: string): Promise<string[]> {
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
  // Private state changes on every refresh and is never a link target.
  return [
    ...new Set(
      stdout.split("\0").filter((path) => path.length > 0 && !path.startsWith(".lervo/state/")),
    ),
  ];
}

/** Publication indexes and root entrypoints are reached from outside the document tree. */
function needsInboundLink(path: string, canonical: boolean): boolean {
  return canonical && path.includes("/") && !/(^|\/)(README|index)\.mdx?$/iu.test(path);
}

/**
 * ADR-0551: rebuilds the link web only when tracked Markdown changed, off the prompt path.
 * Untracked but not ignored Markdown counts, so a new document is linked before it is committed.
 */
export async function refreshLinkWeb(root: string, now: Date): Promise<LinkWebSummary> {
  const files = await trackedFiles(root);
  // Lervo-generated outputs under .lervo are projections, not repository knowledge.
  const markdown = files
    .filter((path) => /\.mdx?$/iu.test(path) && !path.startsWith(".lervo/"))
    .sort();
  const stats = await Promise.all(
    markdown.map((path) =>
      stat(resolve(root, path)).then(
        (value) => ({ path, size: value.size, file: value.isFile() }),
        () => null,
      ),
    ),
  );
  const present = stats.filter(
    (entry): entry is NonNullable<typeof entry> =>
      entry !== null && entry.file && entry.size <= MAXIMUM_DOCUMENT_BYTES,
  );
  const documents = await Promise.all(
    present.map(async (entry) => ({
      path: entry.path,
      content: await readFile(resolve(root, entry.path), "utf8"),
    })),
  );
  // Content and every link target path decide the result, so both bind reuse.
  const digest = createHash("sha256");
  for (const document of documents)
    digest.update(
      `${document.path}\0${createHash("sha256").update(document.content).digest("hex")}\n`,
    );
  digest.update(files.join("\0"));
  // The layout taxonomy decides canonical and archive scopes, so it binds reuse too.
  const taxonomy = await loadDecisionTaxonomy(root);
  digest.update(`\0${JSON.stringify(taxonomy)}`);
  const inputDigest = `sha256:${digest.digest("hex")}`;
  const previous = await readLinkWeb(root);
  if (previous?.inputDigest === inputDigest && (await governingIndexPresent(root))) {
    // Unchanged input is re-observed, so an idle repository's measure does not expire.
    if (now.getTime() - Date.parse(previous.observedAt) < REOBSERVE_MS) return previous;
    const reobserved = { ...previous, observedAt: now.toISOString() };
    await writePrivateStateJson(root, STATE, reobserved);
    return reobserved;
  }

  const trackedPaths = new Set<string>();
  for (const path of files) {
    trackedPaths.add(path);
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1)
      trackedPaths.add(segments.slice(0, index).join("/"));
  }
  // ADR-0552: the same documents give the governing index the Stop check reads.
  await writeGoverningIndex(
    root,
    buildGoverningIndex({
      documents,
      // Roadmaps track delivery; they name code paths as evidence, not as rules over them.
      canonical: (path) =>
        !path.split("/").includes("roadmap") &&
        ["instructions", "canonical_documents"].includes(repositoryScanPriority(path, taxonomy)),
      archiveScopes: archiveScopes(taxonomy),
    }),
  );
  const web = buildDocumentLinkWeb({
    documents,
    trackedPaths,
    canonical: (path) =>
      needsInboundLink(path, repositoryScanPriority(path, taxonomy) === "canonical_documents"),
    archiveScopes: archiveScopes(taxonomy),
  });
  const summary: LinkWebSummary = {
    schemaVersion: 1,
    observedAt: now.toISOString(),
    inputDigest,
    documentCount: web.documentCount,
    linkCount: web.linkCount,
    brokenCount: web.broken.length,
    orphanCount: web.orphans.length,
    missingBacklinkCount: web.missingBacklinks.length,
    truncatedCount: web.truncated.length,
    broken: web.broken.slice(0, SAMPLE),
    orphans: web.orphans.slice(0, SAMPLE),
    missingBacklinks: web.missingBacklinks.slice(0, SAMPLE),
  };
  await writePrivateStateJson(root, STATE, summary);
  return summary;
}

export async function readLinkWeb(root: string): Promise<LinkWebSummary | null> {
  const value = (await readPrivateStateJson(root, STATE, 256 * 1024)) as LinkWebSummary | null;
  const count = (item: unknown) => Number.isSafeInteger(item) && (item as number) >= 0;
  return value?.schemaVersion === 1 &&
    typeof value.inputDigest === "string" &&
    Number.isFinite(Date.parse(value.observedAt)) &&
    [
      value.documentCount,
      value.linkCount,
      value.brokenCount,
      value.orphanCount,
      value.missingBacklinkCount,
    ].every(count) &&
    Array.isArray(value.broken) &&
    Array.isArray(value.orphans) &&
    Array.isArray(value.missingBacklinks)
    ? value
    : null;
}
