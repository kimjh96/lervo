import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  canonicalJson,
  practicePublicPath,
  sanitizePracticeText,
  scanConfiguredRepositoryKnowledge,
  sha256,
  type ReusablePractice,
} from "@lervo/repository-knowledge";
import { repositoryPathWithinScope } from "@lervo/work-controller";
import type { PracticeEvidence, PracticeWorkRecord } from "./practice-state.js";

const execute = promisify(execFile);

/** Git blobs cannot follow a working-tree symlink, and only observed, hash-bound bytes are cited. */
export async function retainPracticeEvidence(
  root: string,
  work: PracticeWorkRecord,
  procedure: ReusablePractice,
  readRoots: string[],
  ownerResponse?: PracticeEvidence["ownerResponse"],
): Promise<PracticeEvidence> {
  const scan = procedure.sourcePaths.length
    ? (await scanConfiguredRepositoryKnowledge(root)).scan
    : null;
  const excerpts: PracticeEvidence["excerpts"] = [];
  for (const path of procedure.sourcePaths) {
    if (
      !practicePublicPath(path) ||
      !readRoots.some((r) => repositoryPathWithinScope(path, r)) ||
      (!work.stopCommit && !work.changedFiles.some((f) => f.path === path && f.after !== null))
    )
      throw new TypeError("Practice source is outside the read scope.");
    const source = scan?.sources.find((s) => s.path === path && s.status === "included");
    if (!source?.contentHash || source.content === undefined)
      throw new TypeError("Practice source is excluded by the scanner.");
    const changed = work.changedFiles.find((f) => f.path === path);
    let bytes: Buffer;
    if (changed?.after) {
      if (source.contentHash !== changed.after)
        throw new TypeError("Practice source changed after observation.");
      bytes = Buffer.from(source.content, "utf8");
    } else {
      const { stdout: tree } = await execute(
        "git",
        ["-C", root, "ls-tree", work.stopCommit!, "--", path],
        { maxBuffer: 4096 },
      );
      if (!/^100(?:644|755) blob [a-f0-9]+\t/u.test(tree))
        throw new TypeError("Practice source is absent at the observed revision.");
      const { stdout } = await execute("git", ["-C", root, "show", `${work.stopCommit}:${path}`], {
        encoding: "buffer",
        maxBuffer: 1024 * 1024,
        timeout: 2000,
      });
      bytes = stdout;
    }
    const hash = sha256(bytes);
    const excerpt = bytes.subarray(0, 8192).toString("utf8");
    excerpts.push({ path, contentHash: hash, text: sanitizePracticeText(excerpt) });
  }
  const bundle = {
    work,
    procedure,
    excerpts,
    ...(ownerResponse === undefined ? {} : { ownerResponse }),
  };
  if (Buffer.byteLength(canonicalJson(bundle)) > 32 * 1024)
    throw new TypeError("Practice evidence exceeds 32 KiB.");
  if (sanitizePracticeText(canonicalJson(procedure)) !== canonicalJson(procedure))
    throw new TypeError("Practice contains private data.");
  return { ...bundle, evidenceHash: sha256(canonicalJson(bundle)) };
}
