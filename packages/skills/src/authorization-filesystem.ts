import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { validateSchema, type SkillManifest } from "@lervo/schemas";

import {
  createSkillAuthorizationPlanValue,
  hashSkillAuthorizationValue,
  parseSkillAuthorizationPlan,
  SkillAuthorizationError,
  type SkillAuthorizationPlan,
} from "./authorization.js";
import { discoverSkillRoot, hashSkillPackage } from "./package-reader.js";
import {
  sameFileAcrossStatSurfaces,
  sameFileWithinStatSurface,
} from "./stable-file-observation.js";

const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;

async function readManifest(
  path: string,
  missingCode:
    "skill_authorization_invalid" | "skill_authorization_stale" = "skill_authorization_invalid",
): Promise<{ content: string; manifest: SkillManifest; mode: number }> {
  let beforePath;
  try {
    beforePath = await lstat(path);
  } catch (error) {
    throw new SkillAuthorizationError(
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? missingCode
        : "skill_authorization_invalid",
      "The project skill manifest is missing or cannot be inspected safely.",
      { cause: error },
    );
  }
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.size > MAXIMUM_MANIFEST_BYTES
  )
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "The project skill manifest is unsafe or oversized.",
    );
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedHandle = await handle.stat();
    const afterOpenPath = await lstat(path);
    if (
      !openedHandle.isFile() ||
      openedHandle.size > MAXIMUM_MANIFEST_BYTES ||
      !afterOpenPath.isFile() ||
      afterOpenPath.isSymbolicLink() ||
      afterOpenPath.size > MAXIMUM_MANIFEST_BYTES ||
      !sameFileWithinStatSurface(beforePath, afterOpenPath) ||
      !sameFileAcrossStatSurfaces(afterOpenPath, openedHandle)
    )
      throw new SkillAuthorizationError(
        "skill_authorization_stale",
        "The project skill manifest changed before authorization planning.",
      );
    const bytes = await handle.readFile();
    const afterReadHandle = await handle.stat();
    const afterReadPath = await lstat(path);
    if (
      !afterReadHandle.isFile() ||
      afterReadHandle.size > MAXIMUM_MANIFEST_BYTES ||
      !afterReadPath.isFile() ||
      afterReadPath.isSymbolicLink() ||
      afterReadPath.size > MAXIMUM_MANIFEST_BYTES ||
      !sameFileWithinStatSurface(openedHandle, afterReadHandle) ||
      !sameFileWithinStatSurface(afterOpenPath, afterReadPath) ||
      !sameFileAcrossStatSurfaces(afterReadPath, afterReadHandle)
    )
      throw new SkillAuthorizationError(
        "skill_authorization_stale",
        "The project skill manifest changed while it was read.",
      );
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const manifest: unknown = JSON.parse(content);
    if (!validateSchema("skill", manifest).valid)
      throw new SkillAuthorizationError(
        "skill_authorization_invalid",
        "The project skill manifest does not satisfy the skill contract.",
      );
    return { content, manifest: manifest as SkillManifest, mode: beforePath.mode & 0o777 };
  } catch (error) {
    if (error instanceof SkillAuthorizationError) throw error;
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "The project skill manifest cannot be read safely.",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

function relativeManifestPath(repositoryRoot: string, directoryPath: string): string {
  const path = relative(repositoryRoot, resolve(directoryPath, "lervo-skill.json"))
    .split(sep)
    .join("/");
  if (!/^\.agents\/skills\/[a-z][a-z0-9-]*\/lervo-skill\.json$/u.test(path))
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "The project skill manifest path is outside the authorization boundary.",
    );
  return path;
}

export async function createSkillAuthorizationPlan(input: {
  repositoryRoot: string;
  projectId: string;
  skillId: string;
  reviewerId: string;
  reviewedAt: string;
}): Promise<SkillAuthorizationPlan> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const candidates = await discoverSkillRoot({
    root: resolve(repositoryRoot, ".agents/skills"),
    sourceKind: "project",
    sourceUriPrefix: "project:.agents/skills",
    requestedSkillIds: [input.skillId],
  });
  if (candidates.length !== 1)
    throw new SkillAuthorizationError(
      "skill_authorization_not_candidate",
      "Project skill authorization requires one exact promoted skill candidate.",
    );
  const candidate = candidates[0]!;
  const manifestPath = relativeManifestPath(repositoryRoot, candidate.directoryPath);
  const current = await readManifest(resolve(repositoryRoot, manifestPath));
  const contentHash = await hashSkillPackage(candidate.directoryPath);
  if (contentHash !== candidate.manifest.contentHash)
    throw new SkillAuthorizationError(
      "skill_authorization_stale",
      "The project skill content changed before authorization planning.",
    );
  return createSkillAuthorizationPlanValue({
    repositoryRoot,
    projectId: input.projectId,
    manifestPath,
    expectedManifestHash: hashSkillAuthorizationValue(current.content),
    manifest: candidate.manifest,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
  });
}

export interface SkillAuthorizationReceipt {
  schemaVersion: 1;
  operation: "project_skill_authorized";
  planId: string;
  projectId: string;
  skillId: string;
  version: string;
  contentHash: string;
  manifestPath: string;
  manifestHash: string;
  trust: "reviewed";
  enabledScope: "project";
  reviewerId: string;
  reviewedAt: string;
  appliedAt: string;
  status: "applied" | "current";
}

function validTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export async function applySkillAuthorizationPlan(input: {
  plan: SkillAuthorizationPlan;
  approval: string;
  appliedAt: string;
}): Promise<SkillAuthorizationReceipt> {
  const plan = parseSkillAuthorizationPlan(input.plan);
  if (!validTimestamp(input.appliedAt))
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "The project skill authorization apply timestamp is invalid.",
    );
  if (input.approval !== plan.planId)
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "Approval must equal the exact project skill authorization plan ID.",
    );
  const manifestPath = resolve(plan.repositoryRoot, plan.manifestPath);
  const current = await readManifest(manifestPath, "skill_authorization_stale");
  const currentHash = hashSkillAuthorizationValue(current.content);
  const contentHash = await hashSkillPackage(dirname(manifestPath));
  if (contentHash !== plan.contentHash)
    throw new SkillAuthorizationError(
      "skill_authorization_stale",
      "The project skill content changed after authorization review.",
    );
  let status: SkillAuthorizationReceipt["status"] = "current";
  if (currentHash !== plan.desiredManifestHash) {
    if (currentHash !== plan.expectedManifestHash)
      throw new SkillAuthorizationError(
        "skill_authorization_stale",
        "The project skill manifest changed after authorization review.",
      );
    const currentPlan = createSkillAuthorizationPlanValue({
      repositoryRoot: plan.repositoryRoot,
      projectId: plan.projectId,
      manifestPath: plan.manifestPath,
      expectedManifestHash: currentHash,
      manifest: current.manifest,
      reviewerId: plan.reviewerId,
      reviewedAt: plan.reviewedAt,
    });
    if (currentPlan.planId !== plan.planId)
      throw new SkillAuthorizationError(
        "skill_authorization_stale",
        "The project skill authorization plan changed before apply.",
      );
    const desired = `${JSON.stringify(plan.desiredManifest, null, 2)}\n`;
    const temporary = `${manifestPath}.${process.pid}.${randomUUID()}.next`;
    try {
      await rm(temporary, { force: true });
      await writeFile(temporary, desired, {
        encoding: "utf8",
        flag: "wx",
        mode: current.mode,
      });
      if (
        hashSkillAuthorizationValue(
          (await readManifest(manifestPath, "skill_authorization_stale")).content,
        ) !== currentHash
      )
        throw new SkillAuthorizationError(
          "skill_authorization_stale",
          "The project skill manifest changed before authorization commit.",
        );
      await rename(temporary, manifestPath);
      if (
        hashSkillAuthorizationValue(
          (await readManifest(manifestPath, "skill_authorization_stale")).content,
        ) !== plan.desiredManifestHash
      )
        throw new SkillAuthorizationError(
          "skill_authorization_write_failed",
          "The project skill authorization manifest could not be verified after replacement.",
        );
      status = "applied";
    } catch (error) {
      if (error instanceof SkillAuthorizationError) throw error;
      throw new SkillAuthorizationError(
        "skill_authorization_write_failed",
        "The project skill authorization manifest could not be replaced atomically.",
        { cause: error },
      );
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return {
    schemaVersion: 1,
    operation: "project_skill_authorized",
    planId: plan.planId,
    projectId: plan.projectId,
    skillId: plan.skillId,
    version: plan.version,
    contentHash: plan.contentHash,
    manifestPath: plan.manifestPath,
    manifestHash: plan.desiredManifestHash,
    trust: "reviewed",
    enabledScope: "project",
    reviewerId: plan.reviewerId,
    reviewedAt: plan.reviewedAt,
    appliedAt: input.appliedAt,
    status,
  };
}
