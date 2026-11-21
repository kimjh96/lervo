import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectProviderSchemaHashes } from "./lib/provider-schema-hashes.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const allowlist = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "scripts/quality/provider-schema-hash-allowlist.json"),
    "utf8",
  ),
);
const result = await inspectProviderSchemaHashes({ repositoryRoot, allowlist });
if (result.issues.length > 0) {
  process.stderr.write(
    `Provider schema hash check failed (${result.issues.length}):\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Provider schema hash check passed (${result.files.length} production source files).\n`,
  );
}
