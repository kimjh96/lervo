import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { currentReleaseNotesPath, readCurrentReleaseNotes } from "../lib/release-notes.mjs";

try {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      "expected-tag": { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const repositoryRoot = resolve(parsed.values.root ?? ".");
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
  );
  const notes = await readCurrentReleaseNotes(repositoryRoot);
  const expectedTag = `v${manifest.version}`;
  if (notes.package !== "@lervo/cli" || notes.version !== manifest.version)
    throw new Error("Current release notes do not match the public CLI package version.");
  if (parsed.values["expected-tag"] !== undefined && parsed.values["expected-tag"] !== expectedTag)
    throw new Error("The requested tag does not match the current release notes.");
  const result = {
    schemaVersion: 1,
    package: notes.package,
    version: notes.version,
    tag: expectedTag,
    path: currentReleaseNotesPath,
  };
  process.stdout.write(
    parsed.values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Current release notes match ${expectedTag}.\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
