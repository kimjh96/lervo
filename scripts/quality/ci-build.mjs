import { resolve } from "node:path";

import { createCiBuildTransfer, restoreCiBuildTransfer } from "./lib/ci-build-transfer.mjs";

const [operation, destination] = process.argv.slice(2);
if (!["create", "restore"].includes(operation) || !destination)
  throw new Error("Usage: ci-build.mjs <create|restore> <artifact-directory>");
const owner = operation === "create" ? createCiBuildTransfer : restoreCiBuildTransfer;
const receipt = await owner({
  repositoryRoot: resolve(import.meta.dirname, "../.."),
  artifactDirectory: resolve(destination),
});
process.stdout.write(
  `${JSON.stringify({ ...receipt, directories: receipt.directories.length })}\n`,
);
