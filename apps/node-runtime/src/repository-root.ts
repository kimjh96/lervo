import { lstat } from "node:fs/promises";

import { NodeRuntimeError } from "./errors.js";

/** The Node serves only an initialized physical repository directory, never a symbolic link. */
export async function assertRepositoryRoot(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("unsafe root");
  } catch (error) {
    throw new NodeRuntimeError(
      "project_invalid",
      "The Node runtime repository root must be an initialized physical directory.",
      { cause: error },
    );
  }
}
