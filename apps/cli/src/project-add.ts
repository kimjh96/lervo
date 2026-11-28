import { randomBytes } from "node:crypto";
import { access, constants, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { applyCapabilityMigration, createCapabilityMigrationPlan } from "@lervo/capabilities";
import { renameProject, validDisplayName } from "@lervo/project";
import {
  defaultRepositoryRegistryPath,
  registerRepository,
  type RepositoryRegistration,
} from "@lervo/repository-registry";

import { noticeEffect } from "./effect-notice.js";
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
  /** Whether Lervo made the repository's first commit, so work can start from it. */
  firstCommit: boolean;
}

/** The identity of a first commit when Git has none configured for the owner. */
const FALLBACK_IDENTITY = ["-c", "user.name=Lervo", "-c", "user.email=lervo@localhost.invalid"];

async function hasCommit(root: string): Promise<boolean> {
  const any = await runGit(root, ["rev-list", "-n", "1", "--all"], { timeout: GIT_TIMEOUT_MS });
  return any !== "";
}

async function configuredIdentity(root: string): Promise<boolean> {
  const email = await runGit(root, ["config", "user.email"], { timeout: GIT_TIMEOUT_MS }).catch(
    () => "",
  );
  return email !== "";
}

/**
 * Makes the first commit of a new project, with what Lervo wrote there, so the first workspace has
 * a commit to start from (Lervo ADE projects, "Adding a project"). It uses the owner's Git
 * identity, or Lervo's when none is configured, and is reported after the fact.
 */
async function commitFirst(root: string): Promise<boolean> {
  if (await hasCommit(root)) return false;
  const identity = (await configuredIdentity(root)) ? [] : FALLBACK_IDENTITY;
  await runGit(root, ["add", "-A"], { timeout: GIT_TIMEOUT_MS });
  await runGit(
    root,
    [...identity, "commit", "--quiet", "--allow-empty", "-m", FIRST_COMMIT_MESSAGE],
    {
      timeout: GIT_TIMEOUT_MS,
    },
  );
  await noticeEffect({
    repositoryRoot: root,
    effect: "project_first_commit",
    subject: `first_commit:${Date.now()}`,
    targets: ["HEAD"],
    reason: "project_has_no_commit",
    reviewers: ["git_head_reread"],
    verdict: "verified",
    undo: `git -C '${root.replaceAll("'", "'\\''")}' update-ref -d HEAD`,
  }).catch(() => undefined);
  return true;
}

const FIRST_COMMIT_MESSAGE = "Start the project with Lervo";

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

/**
 * Refuses a projects location inside a Git work tree, where every new project would land inside
 * another repository. macOS folders ignore case, so the default `~/Lervo` is a checkout cloned
 * at `~/lervo` (Lervo ADE projects, "Adding a project").
 */
async function outsideWorkTree(path: string): Promise<void> {
  if (await insideGitWorkTree(path))
    throw new ProjectAddError(
      "projects_location_invalid",
      `${path} is inside a Git repository, so projects cannot be created there.`,
    );
}

/**
 * Keeps the owner's projects location, which must be an absolute folder Lervo can write, outside
 * any Git work tree.
 */
export async function setProjectsLocation(path: string): Promise<string> {
  if (!isAbsolute(path) || /[\0\r\n]/u.test(path))
    throw new ProjectAddError(
      "projects_location_invalid",
      "The projects location must be an absolute path.",
    );
  await mkdir(path, { recursive: true });
  await writable(path, "projects_location_invalid");
  await outsideWorkTree(path);
  // The user state directory must stay owner-only, as the registry beside it requires.
  await mkdir(dirname(locationFile()), { recursive: true, mode: 0o700 });
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

/**
 * Packages the repository's skills into `.lervo/capabilities/`, as `lervo init` does. That folder
 * is local state, so a clone of a Lervo project starts without it, and `lervo upgrade` defers the
 * knowledge stages until it exists.
 */
async function packageRepositorySkills(root: string): Promise<void> {
  const plan = await createCapabilityMigrationPlan(root);
  if (plan.status === "ready") await applyCapabilityMigration(plan);
}

/**
 * Makes `root` a registered Lervo project: Git and Lervo initialized when missing. A new project,
 * whose folder holds only what Lervo wrote, gets its first commit; a folder of the owner's files
 * never does, so nothing of theirs is committed without them.
 */
async function adopt(root: string, name: string, created?: { displayName: string }) {
  const gitInitialized = !(await insideGitWorkTree(root));
  if (gitInitialized) await runGit(root, ["init", "--quiet"], { timeout: GIT_TIMEOUT_MS });
  const lervoInitialized = !(await exists(join(root, ".lervo/project.yaml")));
  if (lervoInitialized) await initialize(root, name);
  // The folder keeps an ASCII name; the name the owner gave shows through the profile, which the
  // first commit includes.
  if (created !== undefined && created.displayName !== name)
    await renameProject(root, name, created.displayName);
  const { registration } = await registerRepository({
    registryPath: defaultRepositoryRegistryPath(),
    repositoryRoot: root,
  });
  const firstCommit =
    created === undefined ? false : await commitFirst(registration.repositoryRoot);
  // A project that already had Lervo, such as a clone, skipped `lervo init`. Its skills are
  // packaged here, so its knowledge stages need no `lervo upgrade` first. A failure leaves the
  // stage to `lervo upgrade --apply`, which reports it as pending.
  if (!lervoInitialized)
    await packageRepositorySkills(registration.repositoryRoot).catch(() => undefined);
  // ADR-0469: a registered checkout joins background knowledge continuity at once.
  await onboardKnowledgeContinuity({
    repositoryRoot: registration.repositoryRoot,
    register: false,
  }).catch(() => undefined);
  return { registration, gitInitialized, lervoInitialized, firstCommit };
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
  await outsideWorkTree(source.into);
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
  try {
    const adopted = await adopt(destination, folder, { displayName });
    return { source: "new", displayName, ...adopted };
  } catch (error) {
    // Lervo created the folder empty, so whatever a failed start left there is its own.
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
