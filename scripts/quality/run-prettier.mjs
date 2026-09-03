import { execFile as execFileCallback } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

import * as prettier from "prettier";

import { lervoLifecycleOwnedFormatPaths } from "./lib/format-ownership.mjs";

const execFile = promisify(execFileCallback);

async function repositoryFiles(repositoryRoot) {
  const result = await execFile(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  return result.stdout.toString("utf8").split("\0").filter(Boolean).toSorted();
}

async function formatTargets(repositoryRoot) {
  const lifecycleOwned = await lervoLifecycleOwnedFormatPaths(repositoryRoot);
  const ignorePath = resolve(repositoryRoot, ".prettierignore");
  const targets = [];
  for (const path of await repositoryFiles(repositoryRoot)) {
    if (lifecycleOwned.has(path)) continue;
    const absolute = resolve(repositoryRoot, path);
    const status = await lstat(absolute).catch(() => null);
    if (!status?.isFile()) continue;
    const info = await prettier.getFileInfo(absolute, { ignorePath, withNodeModules: false });
    if (!info.ignored && info.inferredParser !== null) targets.push({ absolute, path });
  }
  return targets;
}

try {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { check: { type: "boolean" }, write: { type: "boolean" } },
  });
  if (parsed.values.check === parsed.values.write)
    throw new Error("Choose exactly one of --check or --write.");
  const repositoryRoot = resolve(".");
  const changed = [];
  for (const target of await formatTargets(repositoryRoot)) {
    const source = await readFile(target.absolute, "utf8");
    const options = (await prettier.resolveConfig(target.absolute)) ?? {};
    const formatted = await prettier.format(source, { ...options, filepath: target.absolute });
    if (formatted === source) continue;
    changed.push(target.path);
    if (parsed.values.write) await writeFile(target.absolute, formatted, "utf8");
  }
  if (parsed.values.check) {
    if (changed.length === 0) process.stdout.write("All Prettier-owned files are formatted.\n");
    else {
      process.stderr.write(
        `Prettier formatting differs in ${changed.length} owned file(s):\n${changed.map((path) => `  ${path}`).join("\n")}\n`,
      );
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(`Formatted ${changed.length} Prettier-owned file(s).\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
