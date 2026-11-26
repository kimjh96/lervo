import { randomBytes } from "node:crypto";
import { access, constants, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { renameProject, validDisplayName } from "@lervo/project";
import {
  defaultRepositoryRegistryPath,
  registerRepository,
  type RepositoryRegistration,
} from "@lervo/repository-registry";

import { runInitCommand } from "./init-command.js";
import { onboardKnowledgeContinuity } from "./knowledge-continuity-onboarding.js";
import { GitRunError, runGit } from "./workspace-base-git.js";

/** A failure of adding a project, with its code (Lervo ADE projects, failure meaning). */
export class ProjectAddError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectAddError";
  }
}

/** How long a clone may take before it is stopped with every helper Git started. */
const CLONE_TIMEOUT_MS = 10 * 60_000;
const GIT_TIMEOUT_MS = 30_000;
const MAXIMUM_FOLDER_NAME = 40;

export type ProjectSource =
  | { kind: "folder"; path: string }
  | { kind: "clone"; url: string; into: string }
  | { kind: "new"; name: string; into: string };

export interface AddedProject {
  source: ProjectSource["kind"];
  registration: RepositoryRegistration;
  displayName: string;
  gitInitialized: boolean;
  lervoInitialized: boolean;
}

const locationFile = () => join(dirname(defaultRepositoryRegistryPath()), "projects-location.json");

/** Where clones and new projects go: `~/Lervo` until the owner chooses another folder. */
export async function projectsLocation(): Promise<string> {
  try {
    const value = JSON.parse(await readFile(locationFile(), "utf8")) as { path?: unknown };
    if (typeof value.path === "string" && isAbsolute(value.path)) return value.path;
  } catch {
    // No choice yet, or an unreadable one: the default applies.
  }
  return join(homedir(), "Lervo");
}

/** Keeps the owner's projects location, which must be an absolute folder Lervo can write. */
export async function setProjectsLocation(path: string): Promise<string> {
  if (!isAbsolute(path) || /[\0\r\n]/u.test(path))
    throw new ProjectAddError(
      "projects_location_invalid",
      "The projects location must be an absolute path.",
    );
  await mkdir(path, { recursive: true });
  await writable(path, "projects_location_invalid");
  await mkdir(dirname(locationFile()), { recursive: true });
  await writeFile(
    locationFile(),
    `${JSON.stringify({ schemaVersion: 1, kind: "lervo_projects_location", path: resolve(path) }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return resolve(path);
}

async function writable(path: string, code: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error("not a directory");
    await access(path, constants.W_OK);
  } catch (error) {
    throw new ProjectAddError(code, `${path} is not a folder Lervo can write.`, { cause: error });
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * A folder name for a new project: the name's ASCII words joined by hyphens, at most 40
 * characters, or else `project-<yyyymmdd>-<4 hex>` (Lervo ADE projects, "Adding a project").
 */
export function newProjectFolderName(name: string, now = new Date()): string {
  const words = name.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  let folder = "";
  for (const word of words) {
    const next = folder === "" ? word : `${folder}-${word}`;
    if (next.length > MAXIMUM_FOLDER_NAME) break;
    folder = next;
  }
  if (folder.length >= 2) return folder;
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `project-${day}-${randomBytes(2).toString("hex")}`;
}

/** The repository's name in a clone link, such as `argo` for `git@host:acme/argo.git`. */
export function cloneFolderName(url: string): string {
  const last =
    url
      .trim()
      .replace(/[/\\]+$/u, "")
      .split(/[/:\\]/u)
      .at(-1) ?? "";
  const name = last.replace(/\.git$/u, "");
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(name) || name === "." || name === "..")
    throw new ProjectAddError("project_clone_failed", "The link does not name a repository.");
  return name;
}

async function insideGitWorkTree(path: string): Promise<boolean> {
  try {
    return (
      (await runGit(path, ["rev-parse", "--is-inside-work-tree"], { timeout: GIT_TIMEOUT_MS })) ===
      "true"
    );
  } catch {
    return false;
  }
}

/** Runs `lervo init` in the folder, with its onboarding, as a terminal run would. */
async function initialize(root: string, name: string): Promise<void> {
  const errors: string[] = [];
  const code = await runInitCommand(["--root", root, "--name", name, "--json"], {
    cwd: root,
    stdout: () => undefined,
    stderr: (message: string) => errors.push(message),
  });
  if (code !== 0)
    throw new ProjectAddError(
      "project_init_failed",
      errors.join("").trim().slice(0, 400) || "lervo init failed.",
    );
}

/** Makes `root` a registered Lervo project: Git and Lervo initialized when missing. */
async function adopt(root: string, name: string) {
  const gitInitialized = !(await insideGitWorkTree(root));
  if (gitInitialized) await runGit(root, ["init", "--quiet"], { timeout: GIT_TIMEOUT_MS });
  const lervoInitialized = !(await exists(join(root, ".lervo/project.yaml")));
  if (lervoInitialized) await initialize(root, name);
  const { registration } = await registerRepository({
    registryPath: defaultRepositoryRegistryPath(),
    repositoryRoot: root,
  });
  // ADR-0469: a registered checkout joins background knowledge continuity at once.
  await onboardKnowledgeContinuity({
    repositoryRoot: registration.repositoryRoot,
    register: false,
  }).catch(() => undefined);
  return { registration, gitInitialized, lervoInitialized };
}

/** Adds a project from a folder, a clone link, or a name alone, and registers it on this host. */
export async function addProject(
  source: ProjectSource,
  options: { cloneTimeoutMs?: number } = {},
): Promise<AddedProject> {
  if (source.kind === "folder") {
    if (!isAbsolute(source.path))
      throw new ProjectAddError("project_root_invalid", "The folder must be an absolute path.");
    const root = resolve(source.path);
    await writable(root, "project_root_invalid");
    const adopted = await adopt(root, newProjectFolderName(basename(root)));
    return { source: "folder", displayName: adopted.registration.name, ...adopted };
  }
  await mkdir(source.into, { recursive: true });
  await writable(source.into, "projects_location_invalid");
  if (source.kind === "clone") {
    const destination = join(source.into, cloneFolderName(source.url));
    if (await exists(destination))
      throw new ProjectAddError("project_folder_exists", `${destination} already exists.`);
    try {
      await runGit(source.into, ["clone", "--quiet", "--", source.url, destination], {
        timeout: options.cloneTimeoutMs ?? CLONE_TIMEOUT_MS,
      });
    } catch (error) {
      // The destination did not exist before, so whatever a failed clone left is its own.
      await rm(destination, { recursive: true, force: true });
      throw new ProjectAddError(
        "project_clone_failed",
        error instanceof GitRunError ? error.message : "git clone failed.",
        { cause: error },
      );
    }
    const adopted = await adopt(destination, newProjectFolderName(basename(destination)));
    return { source: "clone", displayName: adopted.registration.name, ...adopted };
  }
  const displayName = validDisplayName(source.name);
  const folder = newProjectFolderName(displayName);
  const destination = join(source.into, folder);
  if (await exists(destination))
    throw new ProjectAddError("project_folder_exists", `${destination} already exists.`);
  await mkdir(destination);
  const adopted = await adopt(destination, folder);
  // The folder keeps an ASCII name; the name the owner gave shows through the profile.
  if (displayName !== adopted.registration.name)
    await renameProject(
      adopted.registration.repositoryRoot,
      adopted.registration.name,
      displayName,
    );
  return { source: "new", displayName, ...adopted };
}
