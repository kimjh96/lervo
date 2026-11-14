import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Finds closures that may read a run-unique environment variable (ADR-0565, Stage 2). G holds
 * every other variable, so such a read is the one environment input a reuse key cannot cover. A
 * process reads a variable by its name, so a file is reusable only when no name occurs where code
 * could read it in its test file, its recorded inputs or the installed packages it loaded. A
 * source or package that cannot be read in full counts as naming them. A name built at run time,
 * or a scan of the whole environment, is not found; that is a known gap.
 */
const maximumPackageBytes = 256 * 1024 * 1024;
const maximumPackageFiles = 50_000;

/** The installed directory of a dependency key such as `pnpm:@scope+name@1.0.0_peer@2`. */
export function ciTestDependencyDirectory(key) {
  if (key.startsWith("package:")) return `node_modules/${key.slice("package:".length)}`;
  if (!key.startsWith("pnpm:")) return null;
  const id = key.slice("pnpm:".length);
  const scoped = id.startsWith("@");
  const at = id.indexOf("@", scoped ? 1 : 0);
  if (at <= 0) return null;
  const name = id.slice(0, at).replace("+", "/");
  return `node_modules/.pnpm/${id}/node_modules/${name}`;
}

/** `names`: the run-unique variable names. Returns memoized `source(path)` and `dependency(key)`. */
export function createCiTestEnvironmentScan(repositoryRoot, names) {
  // In text, a name counts where code can read a variable by it: quoted, as a member, in a shell
  // expansion, or destructured from an environment object. A constant that merely shares the
  // name, such as `const INVOCATION_ID = /.../`, does not. Binary files hold strings without
  // quotes, so in them any whole token counts.
  const alternatives = names.join("|");
  const token = `(?<![A-Za-z0-9_$])(?:${alternatives})(?![A-Za-z0-9_$])`;
  const textPattern = new RegExp(
    [
      `["'\`](?:${alternatives})["'\`]`,
      `\\.(?:${alternatives})(?![A-Za-z0-9_$])`,
      `\\$\\{?(?:${alternatives})(?![A-Za-z0-9_])`,
      `%(?:${alternatives})%`,
      `\\{[^{}]*${token}[^{}]*\\}\\s*=[^;\\n]*\\benv\\b`,
    ].join("|"),
    "u",
  );
  const binaryPattern = new RegExp(token, "u");
  const needles = names.map((name) => Buffer.from(name));
  const mentions = (bytes) => {
    if (!needles.some((needle) => bytes.includes(needle))) return false;
    const pattern = bytes.includes(0) ? binaryPattern : textPattern;
    return pattern.test(bytes.toString("latin1"));
  };
  const sources = new Map();
  const packages = new Map();

  function sourceMentions(path) {
    try {
      return mentions(readFileSync(resolve(repositoryRoot, path)));
    } catch (error) {
      // A path that is gone or is a directory holds no source; anything else is unknown.
      return !["ENOENT", "EISDIR", "ENOTDIR"].includes(error?.code);
    }
  }

  function packageMentions(key) {
    const directory = ciTestDependencyDirectory(key);
    if (directory === null) return true;
    try {
      const root = resolve(repositoryRoot, directory);
      const names = readdirSync(root, { recursive: true }).map(String);
      if (names.length > maximumPackageFiles) return true;
      let bytes = 0;
      for (const name of names) {
        const path = resolve(root, name);
        const stats = lstatSync(path);
        if (!stats.isFile()) continue;
        bytes += stats.size;
        if (bytes > maximumPackageBytes) return true;
        if (mentions(readFileSync(path))) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  return {
    source(path) {
      if (!sources.has(path)) sources.set(path, sourceMentions(path));
      return sources.get(path);
    },
    dependency(key) {
      if (!packages.has(key)) packages.set(key, packageMentions(key));
      return packages.get(key);
    },
  };
}
