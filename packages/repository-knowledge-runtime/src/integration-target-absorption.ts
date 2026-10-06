import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

const execute = promisify(execFile);

/** The identity every Lervo integration and synchronization commit carries. */
export const LERVO_KNOWLEDGE_COMMITTER_EMAIL = "knowledge@lervo.invalid";
/** Backups of absorbed integration tips; only the newest are retained. */
export const ABSORBED_INTEGRATION_BACKUP_PREFIX = "refs/lervo/knowledge-integration-absorbed/";
const MAXIMUM_ABSORBED_BACKUPS = 8;

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

async function blob(root: string, commit: string, path: string): Promise<string | null> {
  try {
    return await git(root, ["rev-parse", "--verify", "--quiet", `${commit}:${path}`]);
  } catch {
    return null;
  }
}

export interface IntegrationTargetAbsorption {
  target: string;
  head: string;
  base: string;
  /** Ref-only paths whose bytes equal the base, or that a base-side commit decided. */
  absorbedPaths: string[];
  /** Ref-only paths only Lervo committed and the base never adopted; normalization re-proposes. */
  droppedPaths: string[];
}

/**
 * ADR-0482: a squash merge brings the integration ref's content into the base branch under other
 * commits, so the two histories diverge while the base already holds the merged decision. The ref
 * is absorbed when every ref-only path either equals the base, was changed by a base-side commit,
 * or was committed only by Lervo. At least one path must be decided by the base. Any other
 * ref-only path, such as an owner commit the base never received, is real divergence.
 */
export async function inspectIntegrationTargetAbsorption(
  root: string,
  target: string,
  head: string,
): Promise<IntegrationTargetAbsorption | null> {
  const base = await git(root, ["merge-base", target, head]).catch(() => "");
  if (base === "" || base === target || base === head) return null;
  const split = (output: string) => output.split("\0").filter(Boolean);
  const refOnly = split(await git(root, ["diff", "--name-only", "-z", base, target]));
  const baseChanged = new Set(split(await git(root, ["diff", "--name-only", "-z", base, head])));
  const absorbedPaths: string[] = [];
  const droppedPaths: string[] = [];
  for (const path of refOnly) {
    if (
      baseChanged.has(path) ||
      (await blob(root, target, path)) === (await blob(root, head, path))
    ) {
      absorbedPaths.push(path);
      continue;
    }
    const authors = split(
      await git(root, ["log", "-z", "--format=%ce", `${base}..${target}`, "--", path]),
    );
    if (
      authors.length === 0 ||
      authors.some((author) => author !== LERVO_KNOWLEDGE_COMMITTER_EMAIL)
    )
      return null;
    droppedPaths.push(path);
  }
  if (!absorbedPaths.some((path) => baseChanged.has(path))) return null;
  return { target, head, base, absorbedPaths, droppedPaths };
}

/**
 * Moves the Lervo-only integration ref to the base with a compare-and-swap after keeping the old
 * tip under `refs/lervo/`. It never touches the working tree or any user branch.
 */
export async function absorbIntegrationTarget(
  root: string,
  ref: string,
  absorption: IntegrationTargetAbsorption,
): Promise<{ backupRef: string; pathSetHash: string }> {
  const backupRef = `${ABSORBED_INTEGRATION_BACKUP_PREFIX}${absorption.target}`;
  await git(root, ["update-ref", backupRef, absorption.target, ""]).catch(() => undefined);
  if (
    (await git(root, ["rev-parse", "--verify", "--quiet", backupRef]).catch(() => "")) !==
    absorption.target
  )
    throw new Error("The absorbed integration tip could not be backed up.");
  await git(root, ["update-ref", ref, absorption.head, absorption.target]);
  const backups = (
    await git(root, [
      "for-each-ref",
      "--sort=-creatordate",
      "--format=%(refname)",
      ABSORBED_INTEGRATION_BACKUP_PREFIX,
    ])
  )
    .split("\n")
    .filter(Boolean);
  for (const stale of backups.slice(MAXIMUM_ABSORBED_BACKUPS))
    if (stale !== backupRef) await git(root, ["update-ref", "-d", stale]).catch(() => undefined);
  return {
    backupRef,
    pathSetHash: sha256(
      canonicalJson({ absorbed: absorption.absorbedPaths, dropped: absorption.droppedPaths }),
    ),
  };
}
