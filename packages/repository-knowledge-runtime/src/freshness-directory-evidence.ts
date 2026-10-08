import {
  canonicalJson,
  sha256,
  type DocumentFreshnessFindingV1,
  type DocumentFreshnessPathChange,
} from "@lervo/repository-knowledge";
import {
  freshnessEvidencePathAllowed,
  freshnessGit,
  freshnessObject,
} from "./freshness-git-evidence.js";

export interface FreshnessDirectoryWitness {
  path: string;
  beforeTree: string | null;
  afterTree: string | null;
  examined: number;
  omitted: number;
  nextCursor: string | null;
}

export async function expandFreshnessPathChanges(input: {
  repositoryRoot: string;
  finding: DocumentFreshnessFindingV1;
  cursor?: string;
}): Promise<{
  changes: DocumentFreshnessPathChange[];
  directories: FreshnessDirectoryWitness[];
  unavailable: boolean;
}> {
  const { repositoryRoot: root, finding } = input;
  const changes = new Map<string, DocumentFreshnessPathChange>();
  const directories: FreshnessDirectoryWitness[] = [];
  let unavailable = false;
  let remaining = 16;
  for (const change of finding.connectedPathChanges) {
    if (!freshnessEvidencePathAllowed(change.path)) {
      unavailable = true;
      continue;
    }
    try {
      const before =
        finding.verifiedRevision === null
          ? null
          : await freshnessObject(root, finding.verifiedRevision, change.path);
      const after = await freshnessObject(
        root,
        finding.currentRevision,
        change.renamedTo ?? change.path,
      );
      if (before?.kind !== "tree" && after?.kind !== "tree") {
        if (remaining > 0) {
          changes.set(change.path, change);
          remaining -= 1;
        } else unavailable = true;
        continue;
      }
      if (finding.verifiedRevision === null) {
        unavailable = true;
        continue;
      }
      const raw = await freshnessGit(root, [
        "diff",
        "--name-status",
        "-z",
        "-M50%",
        finding.verifiedRevision,
        finding.currentRevision,
        "--",
        change.path,
        ...(change.renamedTo === null ? [] : [change.renamedTo]),
      ]);
      const records = raw.split("\0");
      const children: DocumentFreshnessPathChange[] = [];
      let examined = 0;
      for (let index = 0; index < records.length;) {
        const status = records[index++]!;
        if (status === "") break;
        if (examined >= 128) {
          unavailable = true;
          break;
        }
        examined += 1;
        const path = records[index++];
        const renamedTo = /^[RC]/u.test(status) ? (records[index++] ?? null) : null;
        if (path === undefined) {
          unavailable = true;
          break;
        }
        if (
          !freshnessEvidencePathAllowed(path) ||
          (renamedTo !== null && !freshnessEvidencePathAllowed(renamedTo))
        )
          continue;
        children.push({
          path,
          renamedTo: status.startsWith("R") ? renamedTo : null,
          beforeHash: (await freshnessObject(root, finding.verifiedRevision, path))?.id ?? null,
          afterHash:
            status === "D"
              ? null
              : ((await freshnessObject(root, finding.currentRevision, renamedTo ?? path))?.id ??
                null),
          disposition: status.startsWith("R")
            ? "renamed"
            : status === "D"
              ? "deleted"
              : status === "A" || status.startsWith("C")
                ? "added"
                : "modified",
        });
      }
      const rank = (child: DocumentFreshnessPathChange) =>
        finding.references.some(
          (ref) => ref.target === child.path || ref.target === child.renamedTo,
        )
          ? 0
          : child.renamedTo !== null
            ? 1
            : 2;
      children.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
      const binding = sha256(canonicalJson([change.path, before?.id ?? null, after?.id ?? null]));
      const prefix = `${binding}:`;
      const offset = input.cursor?.startsWith(prefix)
        ? Number(input.cursor.slice(prefix.length))
        : 0;
      const start =
        Number.isSafeInteger(offset) && offset >= 0 && offset < children.length ? offset : 0;
      const selected = children.slice(start, start + remaining);
      for (const child of selected) changes.set(child.path, child);
      remaining -= selected.length;
      const omitted = children.length - selected.length;
      directories.push({
        path: change.path,
        beforeTree: before?.id ?? null,
        afterTree: after?.id ?? null,
        examined,
        omitted,
        nextCursor:
          start + selected.length < children.length ? `${prefix}${start + selected.length}` : null,
      });
    } catch {
      unavailable = true;
    }
  }
  return { changes: [...changes.values()], directories, unavailable };
}
