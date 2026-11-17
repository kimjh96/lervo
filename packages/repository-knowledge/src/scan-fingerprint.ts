import { createHash } from "node:crypto";
import type { BigIntStats, Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";

import { defaultDecisionTaxonomy, type DecisionTaxonomy } from "@lervo/project";

import { loadDocumentLayoutContract } from "./document-layout-contract.js";
import { isIgnorableFilesystemMetadata, isNestedGitWorkingTree } from "./filesystem-metadata.js";
import type { GitIgnoredPaths } from "./git-ignored-paths.js";
import type { GitRevisionObservation } from "./git-revision-source.js";
import { observeGitScanOpening } from "./git-scan-opening.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { loadDocumentMoveLineages } from "./source-lineage.js";
import type { RepositoryKnowledgeScan } from "./types.js";

/**
 * A file whose last change is this close to its observation may change again within the same
 * filesystem timestamp tick, so its stat alone cannot prove its bytes unchanged (Git's "racy"
 * entries). Coarse kernel clocks tick in milliseconds; the bound leaves room for slower ones.
 */
const RACY_WINDOW_NANOSECONDS = 2_000_000_000n;

interface FileStamp {
  absolute: string;
  stamp: string;
  /** Verified by its bytes against the scan's content hash, not by its stat. */
  racy: boolean;
}

/**
 * ADR-0582: everything one repository scan read, in a form that is cheap to observe again. Equal
 * observations mean a fresh scan with the same inputs would read the same bytes and decide the
 * same admissions, so the scan it describes can stand in for that fresh scan.
 */
export interface RepositoryScanFingerprint {
  root: string;
  projectId: string;
  /** Paths the walk can reach; Git ignore changes elsewhere cannot change the scan. */
  walkable: (path: string) => boolean;
  revision: string;
  ignored: string;
  lineages: string;
  taxonomy: string;
  /** Directory listings by absolute path: names and entry types. */
  directories: Map<string, string>;
  nestedWorkingTrees: string[];
  files: Map<string, FileStamp>;
}

function listingDigest(entries: readonly Dirent[]): string {
  const hash = createHash("sha256");
  // The walk never reads filesystem metadata such as `.DS_Store`, so it never invalidates a scan.
  const read = entries.filter((entry) => !isIgnorableFilesystemMetadata(entry));
  for (const entry of read.sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const type = entry.isDirectory()
      ? "d"
      : entry.isFile()
        ? "f"
        : entry.isSymbolicLink()
          ? "l"
          : "o";
    hash.update(`${type}${entry.name}\0`);
  }
  return hash.digest("hex");
}

function fileStamp(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
}

type DocumentMoveLineages = Awaited<ReturnType<typeof loadDocumentMoveLineages>>;

function lineagesDigest(lineages: DocumentMoveLineages): string {
  return sha256(
    canonicalJson({
      identities: [...lineages.identityPathByCurrentPath.entries()].sort(),
      records: lineages.records.map((record) => ({
        file: record.file,
        bytes: sha256(record.bytes),
        activeTerminal: record.activeTerminal,
      })),
    }),
  );
}

/** The taxonomy exactly as the scan resolves it. */
export async function scanDocumentTaxonomy(root: string): Promise<DecisionTaxonomy> {
  return (await loadDocumentLayoutContract(root)).taxonomy ?? defaultDecisionTaxonomy;
}

/** Collects the fingerprint while the scan walks; one recorder belongs to one scan attempt. */
export class RepositoryScanFingerprintRecorder {
  private readonly directories = new Map<string, string>();
  private readonly nestedWorkingTrees: string[] = [];
  private readonly files = new Map<string, FileStamp>();
  private revision: string | null = null;
  private ignored: string | null = null;
  private lineages: string | null = null;
  private taxonomy: string | null = null;
  /** False when an input cannot be observed again exactly; the scan is then never reused. */
  private observable = true;

  constructor(
    private readonly root: string,
    private readonly projectId: string,
    private readonly walkable: (path: string) => boolean,
  ) {}

  /** The lineages and taxonomy the scan resolved paths and priorities with. */
  layout(lineages: DocumentMoveLineages, taxonomy: DecisionTaxonomy): void {
    this.lineages = lineagesDigest(lineages);
    this.taxonomy = sha256(canonicalJson(taxonomy));
  }

  git(revision: GitRevisionObservation, ignored: GitIgnoredPaths): void {
    this.revision = JSON.stringify(revision);
    if (ignored.identity === undefined) this.observable = false;
    else this.ignored = ignored.identity(this.walkable);
  }

  directory(absolute: string, entries: readonly Dirent[]): void {
    this.directories.set(absolute, listingDigest(entries));
  }

  nestedWorkingTree(absolute: string): void {
    this.nestedWorkingTrees.push(absolute);
  }

  file(path: string, absolute: string, stats: BigIntStats): void {
    const observedAt = BigInt(Date.now()) * 1_000_000n;
    const lastChange = stats.ctimeNs > stats.mtimeNs ? stats.ctimeNs : stats.mtimeNs;
    this.files.set(path, {
      absolute,
      stamp: fileStamp(stats),
      racy: lastChange + RACY_WINDOW_NANOSECONDS >= observedAt,
    });
  }

  finish(): RepositoryScanFingerprint | null {
    if (
      !this.observable ||
      this.revision === null ||
      this.ignored === null ||
      this.lineages === null ||
      this.taxonomy === null
    )
      return null;
    return {
      root: this.root,
      projectId: this.projectId,
      walkable: this.walkable,
      revision: this.revision,
      ignored: this.ignored,
      lineages: this.lineages,
      taxonomy: this.taxonomy,
      directories: this.directories,
      nestedWorkingTrees: this.nestedWorkingTrees,
      files: this.files,
    };
  }
}

async function filesUnchanged(
  fingerprint: RepositoryScanFingerprint,
  scan: RepositoryKnowledgeScan,
): Promise<boolean> {
  let hashes: Map<string, string | null> | null = null;
  for (const [path, file] of fingerprint.files) {
    const stats = await lstat(file.absolute, { bigint: true });
    if (fileStamp(stats) !== file.stamp) return false;
    if (!file.racy) continue;
    hashes ??= new Map(scan.sources.map((source) => [source.path, source.contentHash]));
    const contentHash = hashes.get(path) ?? null;
    if (contentHash === null || sha256(await readFile(file.absolute)) !== contentHash)
      return false;
  }
  return true;
}

/**
 * Observes every input of the fingerprinted scan again. Any difference, or any failure to observe,
 * means the scan may no longer describe the repository.
 */
export async function repositoryScanFingerprintHolds(
  fingerprint: RepositoryScanFingerprint,
  scan: RepositoryKnowledgeScan,
): Promise<boolean> {
  try {
    const opening = await observeGitScanOpening(fingerprint.root, {});
    if (JSON.stringify(opening.revisionBefore) !== fingerprint.revision) return false;
    const ignored = await opening.observeIgnoredPaths();
    if (ignored.identity?.(fingerprint.walkable) !== fingerprint.ignored) return false;
    for (const [absolute, listing] of fingerprint.directories) {
      if (listingDigest(await readdir(absolute, { withFileTypes: true })) !== listing)
        return false;
    }
    for (const absolute of fingerprint.nestedWorkingTrees)
      if (!(await isNestedGitWorkingTree(absolute))) return false;
    if (!(await filesUnchanged(fingerprint, scan))) return false;
    const lineages = await loadDocumentMoveLineages({
      repositoryRoot: fingerprint.root,
      projectId: fingerprint.projectId,
    });
    return (
      lineagesDigest(lineages) === fingerprint.lineages &&
      sha256(canonicalJson(await scanDocumentTaxonomy(fingerprint.root))) === fingerprint.taxonomy
    );
  } catch {
    return false;
  }
}
