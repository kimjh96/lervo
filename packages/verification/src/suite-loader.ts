import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { VerificationSuite } from "@lervo/schemas";
import { parse } from "yaml";

import { VerificationError } from "./types.js";
import { readVerificationSuiteFile } from "./suite-file-reader.js";
import { validateVerificationSuite } from "./validation.js";

const MAXIMUM_SUITE_BYTES = 64 * 1024;
const SUITE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export async function loadVerificationSuite(
  repositoryRoot: string,
  suiteId: string,
): Promise<VerificationSuite> {
  if (!SUITE_ID.test(suiteId) || suiteId.length > 150) {
    throw new VerificationError(
      "invalid_verification_suite",
      "The verification suite ID is invalid.",
    );
  }
  const root = resolve(repositoryRoot);
  const directory = resolve(root, ".lervo/verifications");
  try {
    const stats = await lstat(directory);
    const expectedDirectory = resolve(await realpath(root), ".lervo/verifications");
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (await realpath(directory)) !== expectedDirectory
    ) {
      throw new Error("unsafe directory");
    }
  } catch (error) {
    throw new VerificationError(
      "verification_layout_invalid",
      "The verification suite directory is not a safe real directory.",
      { cause: error },
    );
  }
  const path = resolve(directory, `${suiteId}.yaml`);
  try {
    const bytes = await readVerificationSuiteFile(path, MAXIMUM_SUITE_BYTES);
    let value: unknown;
    try {
      value = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      throw new VerificationError(
        "invalid_verification_suite",
        "The verification suite YAML could not be read.",
        { cause: error },
      );
    }
    const suite = value as VerificationSuite;
    validateVerificationSuite(suite);
    if (suite.suiteId !== suiteId) {
      throw new VerificationError(
        "invalid_verification_suite",
        "The verification suite filename and suite ID differ.",
      );
    }
    return structuredClone(suite);
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VerificationError(
        "verification_suite_not_found",
        `Verification suite ${suiteId} was not found.`,
        { cause: error },
      );
    }
    throw new VerificationError(
      "verification_layout_invalid",
      "The verification suite file could not be read safely.",
      { cause: error },
    );
  }
}
