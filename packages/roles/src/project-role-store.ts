// Reading and writing one checkout's own project role sources, `.lervo/roles/<role-id>.json`
// (ADR-0662). What a source says is decided in `project-role-authoring.ts`; whether the registry
// still resolves with it is `previewRoleContracts`'s.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parseRepositoryRoleSource, ROLE_ID } from "./repository-role-source.js";
import type { RepositoryRoleSource } from "./repository-role-source.js";
import { renderRepositoryRoleSource } from "./repository-role-rendering.js";
import { RoleContractError } from "./types.js";

/** The repository-relative path of a role's source. */
export function projectRolePath(roleId: string): string {
  return `.lervo/roles/${roleId}.json`;
}

function absolute(root: string, roleId: string): string {
  if (!ROLE_ID.test(roleId) || roleId.length > 100)
    throw new RoleContractError("role_not_found", "The requested role ID is invalid.");
  return resolve(root, projectRolePath(roleId));
}

/**
 * The checkout's own source of `roleId` and its exact bytes, or null when this checkout has none,
 * such as for a built-in role or one a linked worktree reads from its main checkout.
 */
export async function readOwnRoleSource(
  root: string,
  roleId: string,
): Promise<{ source: RepositoryRoleSource; bytes: string } | null> {
  const path = absolute(root, roleId);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new RoleContractError("role_profile_invalid", `Role source ${roleId} is unsafe.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const bytes = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    throw new RoleContractError("role_profile_invalid", `Role source ${roleId} is not JSON.`, {
      cause: error,
    });
  }
  return { source: parseRepositoryRoleSource(value, roleId), bytes };
}

/**
 * Writes a role's source. `create` refuses a role the checkout already has with `role_exists`;
 * `replace` swaps the bytes in one rename, so a reader never sees half a source.
 */
export async function writeRoleSource(
  root: string,
  source: RepositoryRoleSource,
  mode: "create" | "replace",
): Promise<void> {
  const path = absolute(root, source.roleId);
  const bytes = renderRepositoryRoleSource(source);
  await mkdir(dirname(path), { recursive: true });
  if (mode === "create") {
    try {
      await writeFile(path, bytes, { flag: "wx", mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new RoleContractError("role_exists", `Role ${source.roleId} already exists.`, {
          cause: error,
        });
      throw error;
    }
    return;
  }
  await swap(path, bytes);
}

/** Replaces a file's bytes in one rename, so a reader never sees half of them. */
async function swap(path: string, bytes: string): Promise<void> {
  // The temporary name does not end in `.json`, so the registry never reads it as a role.
  const next = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.next`;
  try {
    await writeFile(next, bytes, { mode: 0o644 });
    await rename(next, path);
  } finally {
    await rm(next, { force: true });
  }
}

/** Restores a role's earlier exact bytes, as an edit that could not finish does. */
export async function restoreRoleSource(
  root: string,
  roleId: string,
  bytes: string,
): Promise<void> {
  await mkdir(dirname(absolute(root, roleId)), { recursive: true });
  await swap(absolute(root, roleId), bytes);
}

/** Removes a role's source from the checkout. */
export async function removeRoleSource(root: string, roleId: string): Promise<void> {
  await rm(absolute(root, roleId));
}
