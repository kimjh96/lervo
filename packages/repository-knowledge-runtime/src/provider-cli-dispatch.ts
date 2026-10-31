import { lstat, open, readlink } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

const managerPath = /(?:^|\/)(?:\.?(?:volta|asdf|mise|nvm)|shims)(?:\/|$)/u;
const nativeMagic = new Set([
  "7f454c46", // ELF
  "feedface",
  "cefaedfe",
  "feedfacf",
  "cffaedfe", // Mach-O
  "cafebabe",
  "bebafeca",
  "cafebabf",
  "bfbafeca", // Universal Mach-O
]);

/** Native version-manager dispatchers still need version observations. */
export async function providerCliNeedsVersionCheck(executable: string, realPath: string) {
  if (managerPath.test(executable) || managerPath.test(realPath)) return true;
  const file = await open(realPath, "r");
  try {
    const header = Buffer.alloc(4);
    await file.read(header, 0, header.length, 0);
    if (!nativeMagic.has(header.toString("hex"))) return true;
  } finally {
    await file.close();
  }
  // Inspect intermediate links too: realpath alone discards version-manager hops.
  let pending = executable.slice(parse(executable).root.length).split("/");
  let current = parse(executable).root;
  let links = 0;
  while (pending.length > 0) {
    current = resolve(current, pending.shift()!);
    if (managerPath.test(current)) return true;
    if (!(await lstat(current)).isSymbolicLink()) continue;
    if (++links > 40) return true;
    const target = resolve(dirname(current), await readlink(current));
    if (managerPath.test(target)) return true;
    pending = [...target.slice(parse(target).root.length).split("/"), ...pending];
    current = parse(target).root;
  }
  return false;
}
