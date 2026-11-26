import { resolve } from "node:path";

import {
  clearProjectMark,
  markAssetPath,
  PROJECT_PROFILE_PATH,
  type ProjectProfileV1,
  readProjectMark,
  readProjectProfile,
  renameProject,
  setProjectMark,
} from "@lervo/project";
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import { noticeEffect } from "./effect-notice.js";
import type { AddedProject } from "./project-add.js";

/**
 * A project's profile operations, shared by `lervo project` and the core link (Lervo ADE
 * projects). Each change is written at once and reported after the fact as an effect notice.
 */

/** The project's root on this host and its manifest name, resolved through the registry. */
export async function locateProject(projectId: string, registry?: string) {
  const registryPath = registry === undefined ? defaultRepositoryRegistryPath() : resolve(registry);
  const registration = await resolveRegisteredRepository({ registryPath, projectId });
  return { root: registration.repositoryRoot, name: registration.name };
}

/** What the terminal and the ADE show: the display name, falling back to the manifest's. */
export function projectView(projectId: string, name: string, profile: ProjectProfileV1 | null) {
  return {
    projectId,
    name,
    displayName: profile?.displayName ?? name,
    mark: profile?.mark ?? null,
  };
}

/** A project as `lervo project add` and `project.add` report it. */
export function addedProjectView(added: AddedProject) {
  const { registration } = added;
  return {
    projectId: registration.projectId,
    name: registration.name,
    displayName: added.displayName,
    root: registration.repositoryRoot,
    source: added.source,
    gitInitialized: added.gitInitialized,
    lervoInitialized: added.lervoInitialized,
  };
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

async function report(
  root: string,
  projectId: string,
  change: { before: ProjectProfileV1; after: ProjectProfileV1 },
  reason: string,
  undo: string,
): Promise<void> {
  const mark = change.after.mark;
  await noticeEffect({
    repositoryRoot: root,
    effect: "project_profile",
    subject: `${projectId}:${Date.now()}`,
    targets: mark === null ? [PROJECT_PROFILE_PATH] : [PROJECT_PROFILE_PATH, markAssetPath(mark)],
    reason,
    reviewers: ["profile_reread"],
    verdict: "verified",
    undo,
  });
}

/** The project's view and whether its profile is present, absent, or invalid. */
export async function showProject(projectId: string, registry?: string) {
  const { root, name } = await locateProject(projectId, registry);
  const read = await readProjectProfile(root);
  const profile = read.state === "present" ? read.profile : null;
  return { ...projectView(projectId, name, profile), profile: read.state };
}

export async function renameReportedProject(
  projectId: string,
  displayName: string,
  registry?: string,
) {
  const { root, name } = await locateProject(projectId, registry);
  const change = await renameProject(root, name, displayName);
  const undo = `lervo project rename --project ${projectId} --name ${quote(change.before.displayName)} --write`;
  await report(root, projectId, change, "project_renamed", undo);
  return projectView(projectId, name, change.after);
}

export async function setReportedProjectMark(
  projectId: string,
  bytes: Uint8Array,
  registry?: string,
) {
  const { root, name } = await locateProject(projectId, registry);
  const change = await setProjectMark(root, name, bytes);
  const undo =
    change.before.mark === null
      ? `lervo project mark clear --project ${projectId} --write`
      : `git -C ${quote(root)} checkout HEAD -- ${PROJECT_PROFILE_PATH} .lervo/assets`;
  await report(root, projectId, change, "project_mark_set", undo);
  return projectView(projectId, name, change.after);
}

export async function clearReportedProjectMark(projectId: string, registry?: string) {
  const { root, name } = await locateProject(projectId, registry);
  const change = await clearProjectMark(root, name);
  const undo = `git -C ${quote(root)} checkout HEAD -- ${PROJECT_PROFILE_PATH} .lervo/assets`;
  await report(root, projectId, change, "project_mark_cleared", undo);
  return projectView(projectId, name, change.after);
}

/** The mark's image as Base64, or null when the project has none. */
export async function readProjectMarkImage(projectId: string, registry?: string) {
  const { root } = await locateProject(projectId, registry);
  const read = await readProjectMark(root);
  if (read === null) return null;
  return {
    sha256: read.mark.sha256,
    mediaType: read.mark.mediaType,
    data: read.bytes.toString("base64"),
  };
}
