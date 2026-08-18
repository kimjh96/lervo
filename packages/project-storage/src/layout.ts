import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { type RovenProjectPaths } from "@roven/project";

import { ProjectStorageError } from "./types.js";

async function requireRealDirectory(path: string, label: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProjectStorageError(
        "storage_layout_invalid",
        `${label} ${path}이 없습니다. 먼저 roven init을 실행하세요.`,
      );
    }
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ProjectStorageError(
      "storage_layout_invalid",
      `${label} ${path}은 실제 디렉터리여야 하며 심볼릭 링크일 수 없습니다.`,
    );
  }
}

async function validateOptionalRealDirectory(path: string, label: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new ProjectStorageError(
        "storage_layout_invalid",
        `${label} ${path}은 실제 디렉터리여야 하며 심볼릭 링크일 수 없습니다.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function validateProjectStorageLayout(
  paths: RovenProjectPaths,
): Promise<void> {
  await requireRealDirectory(paths.repositoryRoot, "저장소 root");
  await requireRealDirectory(paths.rovenRoot, "Roven 설정 경로");
  await requireRealDirectory(paths.state, "Roven 상태 경로");
  await validateOptionalRealDirectory(paths.cas, "CAS 경로");
  await validateOptionalRealDirectory(resolve(paths.cas, "sha256"), "CAS object 경로");
  await validateOptionalRealDirectory(resolve(paths.cas, ".tmp"), "CAS 임시 경로");
}

export async function validateRepositoryRoot(paths: RovenProjectPaths): Promise<void> {
  await requireRealDirectory(paths.repositoryRoot, "저장소 root");
}
