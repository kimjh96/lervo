import { readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

// ADR-0455: platform vocabulary may only grow inside its adapter packages and prefixed files.
export const platformBoundaryRules = [
  {
    platform: "discord",
    term: /discord/iu,
    adapterPackages: ["packages/adapter-discord", "packages/discord-gateway"],
    adapterFilePrefix: "discord-",
  },
  {
    platform: "slack",
    term: /slack/iu,
    // No Slack adapter remains (ADR-0560); any Slack vocabulary in source is a leak.
    adapterPackages: [],
    adapterFilePrefix: "slack-",
  },
];

const sourceExtension = /\.(?:[cm]?[jt]s|tsx)$/u;
const guardedImporter = /^(?:conversation|supervision)-/u;

function repositoryPath(repositoryRoot, path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function isTestPath(path) {
  return path.split("/").includes("test") || /\.test\.[cm]?[jt]sx?$/u.test(path);
}

async function sourceFilesBelow(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(`Could not read ${directory} for the platform boundary scan.`, {
      cause: error,
    });
  }
  const files = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFilesBelow(path)));
    else if (entry.isFile() && sourceExtension.test(entry.name)) files.push(path);
  }
  return files;
}

async function scannedSourceFiles(repositoryRoot) {
  const files = [];
  for (const layer of ["apps", "packages"]) {
    let packages;
    try {
      packages = await readdir(resolve(repositoryRoot, layer), { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error(`Could not list ${layer} for the platform boundary scan.`, { cause: error });
    }
    for (const entry of packages.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      const sourceRoot = resolve(repositoryRoot, layer, entry.name, "src");
      for (const path of await sourceFilesBelow(sourceRoot)) {
        const relativePath = repositoryPath(repositoryRoot, path);
        if (!isTestPath(relativePath)) files.push(relativePath);
      }
    }
  }
  return files;
}

function isAdapterOwned(rule, path) {
  return (
    rule.adapterPackages.some((prefix) => path.startsWith(`${prefix}/`)) ||
    basename(path).toLowerCase().startsWith(rule.adapterFilePrefix)
  );
}

function adapterImports(rule, content) {
  const specifiers = new Set();
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/gu;
  for (const match of content.matchAll(pattern)) {
    if (basename(match[1]).toLowerCase().startsWith(rule.adapterFilePrefix)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers].toSorted();
}

/** Observes current per-file platform mentions outside each platform's adapter boundary. */
export async function observePlatformBoundary(input) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const files = await scannedSourceFiles(repositoryRoot);
  const observation = {};
  for (const rule of platformBoundaryRules) observation[rule.platform] = {};
  for (const path of files) {
    const content = await readFile(resolve(repositoryRoot, path), "utf8");
    const lines = content.split(/\r?\n/u);
    for (const rule of platformBoundaryRules) {
      if (isAdapterOwned(rule, path)) continue;
      const lineCount = lines.filter((line) => rule.term.test(line)).length;
      if (lineCount === 0) continue;
      const imports = guardedImporter.test(basename(path)) ? adapterImports(rule, content) : [];
      observation[rule.platform][path] =
        imports.length === 0 ? { lines: lineCount } : { lines: lineCount, imports };
    }
  }
  return observation;
}

function baselineFiles(baseline, platform) {
  const files = baseline?.platforms?.[platform]?.files;
  return files !== null && typeof files === "object" && !Array.isArray(files) ? files : {};
}

/** Compares an observation with the tracked baseline; any growth is a boundary leak. */
export function comparePlatformBoundary(input) {
  const issues = [];
  if (input.baseline?.schemaVersion !== 1) {
    issues.push("The platform boundary baseline must have schemaVersion 1.");
    return issues;
  }
  for (const rule of platformBoundaryRules) {
    const allowed = baselineFiles(input.baseline, rule.platform);
    for (const [path, observed] of Object.entries(input.observation[rule.platform] ?? {})) {
      const recorded = allowed[path];
      if (recorded === undefined) {
        issues.push(
          `${path} mentions ${rule.platform} on ${observed.lines} line(s) outside its adapter boundary and is absent from the baseline.`,
        );
        continue;
      }
      if (observed.lines > recorded.lines) {
        issues.push(
          `${path} mentions ${rule.platform} on ${observed.lines} line(s); the baseline allows ${recorded.lines}.`,
        );
      }
      const recordedImports = new Set(recorded.imports ?? []);
      for (const specifier of observed.imports ?? []) {
        if (!recordedImports.has(specifier)) {
          issues.push(`${path} newly imports the ${rule.platform} adapter module ${specifier}.`);
        }
      }
    }
  }
  return issues.toSorted();
}

/** Lowers the baseline to the observation; it never raises a count or admits a new file. */
export function lowerPlatformBoundaryBaseline(input) {
  const issues = comparePlatformBoundary(input);
  if (issues.length > 0) return { status: "refused", issues };
  const platforms = {};
  for (const rule of platformBoundaryRules) {
    const allowed = baselineFiles(input.baseline, rule.platform);
    const files = {};
    for (const path of Object.keys(allowed).toSorted()) {
      const observed = input.observation[rule.platform]?.[path];
      if (observed === undefined) continue;
      const recordedImports = new Set(allowed[path].imports ?? []);
      const imports = (observed.imports ?? []).filter((specifier) =>
        recordedImports.has(specifier),
      );
      files[path] = {
        lines: Math.min(observed.lines, allowed[path].lines),
        ...(imports.length === 0 ? {} : { imports }),
      };
    }
    platforms[rule.platform] = { files };
  }
  return { status: "lowered", baseline: { schemaVersion: 1, platforms } };
}

export function platformBoundaryTotals(baseline) {
  return Object.fromEntries(
    platformBoundaryRules.map((rule) => {
      const files = Object.values(baselineFiles(baseline, rule.platform));
      return [
        rule.platform,
        { files: files.length, lines: files.reduce((sum, file) => sum + file.lines, 0) },
      ];
    }),
  );
}
