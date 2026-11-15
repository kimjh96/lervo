import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Formats one file the way the repository's own formatter would. `format` returns the formatted
 * content, or null when the formatter does not own the path (ignored, no parser) or cannot parse
 * it; a null result leaves the bytes unchanged.
 */
export interface KnowledgeOutputFormatter {
  format(absolutePath: string, content: string, ignorePath: string): Promise<string | null>;
}

interface PrettierApi {
  getFileInfo(
    path: string,
    options: { ignorePath: string; withNodeModules: boolean },
  ): Promise<{ ignored: boolean; inferredParser: string | null }>;
  resolveConfig(path: string): Promise<Record<string, unknown> | null>;
  format(source: string, options: Record<string, unknown>): Promise<string>;
}

/**
 * The Prettier the repository itself depends on, resolved from its root, with its own
 * configuration and ignore file. A repository without Prettier has no formatting gate, so this
 * returns null and outputs stay byte-for-byte as reviewed.
 */
export async function loadRepositoryKnowledgeOutputFormatter(
  repositoryRoot: string,
): Promise<KnowledgeOutputFormatter | null> {
  let entry: string;
  try {
    entry = createRequire(resolve(repositoryRoot, "package.json")).resolve("prettier");
  } catch {
    return null;
  }
  // An unloadable formatter leaves the bytes as reviewed; the publisher's check gate still holds.
  const loaded = (await import(pathToFileURL(entry).href).catch(() => null)) as
    (PrettierApi & { default?: PrettierApi }) | null;
  const prettier = typeof loaded?.format === "function" ? loaded : loaded?.default;
  if (prettier === undefined || prettier === null) return null;
  return {
    async format(absolutePath, content, ignorePath) {
      try {
        const info = await prettier.getFileInfo(absolutePath, {
          ignorePath,
          withNodeModules: false,
        });
        if (info.ignored || info.inferredParser === null) return null;
        const options = (await prettier.resolveConfig(absolutePath)) ?? {};
        return await prettier.format(content, { ...options, filepath: absolutePath });
      } catch {
        return null;
      }
    },
  };
}

/**
 * Formats `paths` in place under `directory`. Returns each path whose bytes changed, in path
 * order, mapped to its previous content so a caller whose commit fails can restore it.
 */
export async function formatKnowledgeOutputFiles(input: {
  formatter: KnowledgeOutputFormatter;
  directory: string;
  paths: Iterable<string>;
}): Promise<Map<string, string>> {
  const changed = new Map<string, string>();
  const ignorePath = resolve(input.directory, ".prettierignore");
  for (const path of [...new Set(input.paths)].sort()) {
    const absolute = resolve(input.directory, path);
    const content = await readFile(absolute, "utf8").catch(() => null);
    if (content === null) continue;
    const formatted = await input.formatter.format(absolute, content, ignorePath);
    if (formatted === null || formatted === content) continue;
    await writeFile(absolute, formatted, "utf8");
    changed.set(path, content);
  }
  return changed;
}

/** Puts back the content `formatKnowledgeOutputFiles` replaced. */
export async function restoreKnowledgeOutputFiles(
  directory: string,
  previous: ReadonlyMap<string, string>,
): Promise<void> {
  for (const [path, content] of previous)
    await writeFile(resolve(directory, path), content, "utf8");
}

/** The subset of `contents` whose bytes the formatter would change, sorted; nothing is written. */
export async function unformattedKnowledgeOutputs(input: {
  formatter: KnowledgeOutputFormatter;
  directory: string;
  contents: ReadonlyMap<string, string>;
}): Promise<string[]> {
  const ignorePath = resolve(input.directory, ".prettierignore");
  const unformatted: string[] = [];
  for (const path of [...input.contents.keys()].sort()) {
    const content = input.contents.get(path)!;
    const formatted = await input.formatter.format(
      resolve(input.directory, path),
      content,
      ignorePath,
    );
    if (formatted !== null && formatted !== content) unformatted.push(path);
  }
  return unformatted;
}
