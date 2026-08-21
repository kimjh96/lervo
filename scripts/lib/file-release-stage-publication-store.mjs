import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { canonicalJson } from "./release-artifact-manifest.mjs";
import { ReleasePublicationAuthorizationError } from
  "./release-publication-authorization.mjs";
import {
  validateReleaseStageAttempt,
  validateReleaseStageTerminal,
} from "./release-stage-publication-records.mjs";

const maximumRecordBytes = 128 * 1024;

function fail(code = "release_stage_publication_store_invalid") {
  throw new ReleasePublicationAuthorizationError(
    code,
    "CLI stage 게시 기록 저장소가 올바르지 않습니다.",
  );
}

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureSafeDirectory(path) {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() || metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0
  ) fail("release_stage_publication_store_unsafe");
}

async function writeDurable(path, value) {
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

async function readRecord(path) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 ||
    metadata.size > maximumRecordBytes || (metadata.mode & 0o077) !== 0
  ) fail("release_stage_publication_store_unsafe");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("release_stage_publication_store_corrupt");
  }
}

function bindTerminal(terminal, attempt) {
  validateReleaseStageTerminal(terminal);
  if (
    terminal.attemptDigest !== attempt.attemptDigest ||
    terminal.authorizationDigest !== attempt.authorizationDigest ||
    (terminal.state === "staged" && (
      canonicalJson(terminal.receipt.target) !== canonicalJson(attempt.target) ||
      canonicalJson(terminal.receipt.artifact) !== canonicalJson(attempt.artifact)
    ))
  ) fail("release_stage_publication_terminal_conflict");
  return terminal;
}

export function createFileReleaseStagePublicationStore({ rootDirectory }) {
  if (!isAbsolute(rootDirectory ?? "")) {
    fail("release_stage_publication_store_input_invalid");
  }
  const attemptPath = resolve(rootDirectory, "attempt.json");
  const terminalPath = resolve(rootDirectory, "terminal.json");

  async function existingAttempt() {
    await ensureSafeDirectory(rootDirectory);
    return validateReleaseStageAttempt(await readRecord(attemptPath));
  }

  async function writeTerminal(terminal) {
    const attempt = await existingAttempt();
    bindTerminal(terminal, attempt);
    try {
      await writeDurable(terminalPath, terminal);
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail("release_stage_publication_already_terminal");
      }
      throw error;
    }
    return structuredClone(terminal);
  }

  return {
    async reserve(attempt) {
      validateReleaseStageAttempt(attempt);
      try {
        await mkdir(rootDirectory, { mode: 0o700 });
      } catch (error) {
        if (error?.code === "EEXIST") {
          fail("release_stage_publication_already_attempted");
        }
        throw error;
      }
      await syncDirectory(dirname(rootDirectory));
      try {
        await writeDurable(attemptPath, attempt);
      } catch (error) {
        fail("release_stage_publication_store_incomplete");
      }
      return structuredClone(attempt);
    },
    complete: writeTerminal,
    abort: writeTerminal,
    async markUnknown(terminal) {
      try {
        return await writeTerminal(terminal);
      } catch (error) {
        if (error?.code !== "release_stage_publication_already_terminal") throw error;
        return bindTerminal(
          validateReleaseStageTerminal(await readRecord(terminalPath)),
          await existingAttempt(),
        );
      }
    },
  };
}
