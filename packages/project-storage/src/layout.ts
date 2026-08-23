import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { type LervoProjectPaths } from "@lervo/project";

import { ProjectStorageError } from "./types.js";

async function requireRealDirectory(path: string, label: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProjectStorageError(
        "storage_layout_invalid",
        `${label} ${path} does not exist. Run lervo init first.`,
      );
    }
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ProjectStorageError(
      "storage_layout_invalid",
      `${label} ${path} must be a real directory and cannot be a symbolic link.`,
    );
  }
}

async function validateOptionalRealDirectory(path: string, label: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new ProjectStorageError(
        "storage_layout_invalid",
        `${label} ${path} must be a real directory and cannot be a symbolic link.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function validateProjectStorageLayout(
  paths: LervoProjectPaths,
): Promise<void> {
  await requireRealDirectory(paths.repositoryRoot, "Repository root");
  await requireRealDirectory(paths.lervoRoot, "Lervo configuration path");
  await requireRealDirectory(paths.state, "Lervo state path");
  await validateOptionalRealDirectory(paths.cas, "CAS path");
  await validateOptionalRealDirectory(resolve(paths.cas, "sha256"), "CAS object path");
  await validateOptionalRealDirectory(resolve(paths.cas, ".tmp"), "CAS temporary path");
}

export async function validateRepositoryRoot(paths: LervoProjectPaths): Promise<void> {
  await requireRealDirectory(paths.repositoryRoot, "Repository root");
}
