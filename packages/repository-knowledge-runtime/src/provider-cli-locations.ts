import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

async function nvmDefaultBin(home: string): Promise<string[]> {
  const base = resolve(home, ".nvm");
  const alias = await readFile(resolve(base, "alias/default"), "utf8").catch(() => "");
  const versions = (await readdir(resolve(base, "versions/node")).catch(() => []))
    .filter((name) => /^v\d+\.\d+\.\d+$/u.test(name))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
    .slice(0, 64);
  const named = alias.trim().replace(/^v/u, "");
  const selected = versions.find((name) => name === `v${named}` || name.startsWith(`v${named}.`));
  if (selected !== undefined) return [resolve(base, "versions/node", selected, "bin")];
  if (["node", "stable"].includes(named) && versions[0] !== undefined)
    return [resolve(base, "versions/node", versions[0], "bin")];
  if (/^lts\/[a-z*]+$/u.test(named)) {
    const lts = await readFile(resolve(base, "alias", named), "utf8").catch(() => "");
    if (/^v\d+\.\d+\.\d+$/u.test(lts.trim()))
      return [resolve(base, "versions/node", lts.trim(), "bin")];
  }
  return [];
}

export async function providerCliBins(
  home: string,
  prefixes?: readonly string[],
): Promise<string[]> {
  const npmrc = await readFile(resolve(home, ".npmrc"), "utf8").catch(() => "");
  const configured = npmrc.match(/^\s*prefix\s*=\s*(.*?)\s*$/mu)?.[1]?.replace(/^["']|["']$/gu, "");
  const prefix = configured?.replace(/^~(?=\/)/u, home).replace(/\$\{HOME\}/gu, home);
  return [
    ...new Set([
      ...(prefix !== undefined && isAbsolute(prefix) ? [resolve(prefix, "bin")] : []),
      ...(await nvmDefaultBin(home)),
      resolve(home, ".volta/bin"),
      resolve(home, ".asdf/shims"),
      resolve(home, ".local/share/mise/shims"),
      resolve(home, ".npm-global/bin"),
      resolve(home, ".npm/bin"),
      resolve(home, ".local/bin"),
      resolve(home, ".claude/local"),
      ...(prefixes ?? [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/home/linuxbrew/.linuxbrew/bin",
        resolve(home, ".linuxbrew/bin"),
      ]),
    ]),
  ];
}
