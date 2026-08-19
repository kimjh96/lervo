import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { VerificationSuite } from "@lervo/schemas";
import { parse } from "yaml";

import { VerificationError } from "./types.js";
import { validateVerificationSuite } from "./validation.js";

const MAXIMUM_SUITE_BYTES = 64 * 1024;
const SUITE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export async function loadVerificationSuite(
  repositoryRoot: string,
  suiteId: string,
): Promise<VerificationSuite> {
  if (!SUITE_ID.test(suiteId) || suiteId.length > 150) {
    throw new VerificationError("invalid_verification_suite", "Verification suite ID가 유효하지 않습니다.");
  }
  const root = resolve(repositoryRoot);
  const directory = resolve(root, ".lervo/verifications");
  try {
    const stats = await lstat(directory);
    const expectedDirectory = resolve(await realpath(root), ".lervo/verifications");
    if (
      !stats.isDirectory() || stats.isSymbolicLink() ||
      await realpath(directory) !== expectedDirectory
    ) {
      throw new Error("unsafe directory");
    }
  } catch (error) {
    throw new VerificationError(
      "verification_layout_invalid",
      "Verification suite 디렉터리가 안전한 실제 디렉터리가 아닙니다.",
      { cause: error },
    );
  }
  const path = resolve(directory, `${suiteId}.yaml`);
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAXIMUM_SUITE_BYTES) {
      throw new VerificationError(
        "verification_layout_invalid",
        "Verification suite 파일이 안전한 일반 파일이 아니거나 크기 제한을 넘었습니다.",
      );
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
    ) {
      throw new VerificationError("verification_layout_invalid", "Verification suite가 읽는 동안 바뀌었습니다.");
    }
    let value: unknown;
    try {
      value = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      throw new VerificationError("invalid_verification_suite", "Verification suite YAML을 읽지 못했습니다.", { cause: error });
    }
    const suite = value as VerificationSuite;
    validateVerificationSuite(suite);
    if (suite.suiteId !== suiteId) {
      throw new VerificationError("invalid_verification_suite", "Verification suite 파일명과 suite ID가 다릅니다.");
    }
    return structuredClone(suite);
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VerificationError("verification_suite_not_found", `Verification suite ${suiteId}을 찾을 수 없습니다.`);
    }
    throw new VerificationError("verification_layout_invalid", "Verification suite 파일을 안전하게 읽지 못했습니다.", { cause: error });
  } finally {
    await handle?.close();
  }
}
