import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const maximumRecordBytes = 128 * 1024;

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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

export function createFileImmutableAttemptStore({
  rootDirectory,
  validateAttempt,
  validateTerminal,
  bindTerminal,
  fail,
  codes,
}) {
  if (
    !isAbsolute(rootDirectory ?? "") || typeof validateAttempt !== "function" ||
    typeof validateTerminal !== "function" || typeof bindTerminal !== "function" ||
    typeof fail !== "function"
  ) fail(codes.inputInvalid);
  const attemptPath = resolve(rootDirectory, "attempt.json");
  const terminalPath = resolve(rootDirectory, "terminal.json");

  async function ensureSafeDirectory() {
    let metadata;
    try {
      metadata = await lstat(rootDirectory);
    } catch {
      fail(codes.invalid);
    }
    if (
      !metadata.isDirectory() || metadata.isSymbolicLink() ||
      (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    ) fail(codes.unsafe);
  }

  async function readRecord(path) {
    let metadata;
    try {
      metadata = await lstat(path);
    } catch {
      fail(codes.invalid);
    }
    if (
      !metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 ||
      metadata.size > maximumRecordBytes ||
      (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    ) fail(codes.unsafe);
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      fail(codes.corrupt);
    }
  }

  async function existingAttempt() {
    await ensureSafeDirectory();
    return validateAttempt(await readRecord(attemptPath));
  }

  async function existingTerminal() {
    return validateTerminal(await readRecord(terminalPath));
  }

  async function writeTerminal(terminal) {
    const attempt = await existingAttempt();
    bindTerminal(terminal, attempt);
    try {
      await writeDurable(terminalPath, terminal);
    } catch (error) {
      if (error?.code === "EEXIST") fail(codes.alreadyTerminal);
      throw error;
    }
    return structuredClone(terminal);
  }

  return {
    async reserve(attempt) {
      validateAttempt(attempt);
      try {
        await mkdir(rootDirectory, { mode: 0o700 });
      } catch (error) {
        if (error?.code === "EEXIST") fail(codes.alreadyAttempted);
        throw error;
      }
      await syncDirectory(dirname(rootDirectory));
      try {
        await writeDurable(attemptPath, attempt);
      } catch {
        fail(codes.incomplete);
      }
      return structuredClone(attempt);
    },
    complete: writeTerminal,
    abort: writeTerminal,
    async markUnknown(terminal) {
      try {
        return await writeTerminal(terminal);
      } catch (error) {
        if (error?.code !== codes.alreadyTerminal) throw error;
        return bindTerminal(await existingTerminal(), await existingAttempt());
      }
    },
  };
}
