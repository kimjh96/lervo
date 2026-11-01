import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { governingPreference, repositoryPathsNamedIn } from "../src/governing-preference.js";
import { writeGoverningIndex } from "../src/turn-governance.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-governing-preference-"));
  roots.push(path);
  await mkdir(resolve(path, "apps/cli/src"), { recursive: true });
  await mkdir(resolve(path, ".lervo/state"), { recursive: true });
  await writeFile(resolve(path, "apps/cli/src/query.ts"), "");
  await writeFile(resolve(path, "package.json"), "{}");
  await mkdir(resolve(path, "scripts"), { recursive: true });
  await writeFile(resolve(path, ".gitignore"), "");
  return path;
}

it("finds only existing repository paths written in a query sentence", async () => {
  const path = await root();
  expect(
    repositoryPathsNamedIn(
      path,
      "Fix ranking in apps/cli/src/query.ts, apps/cli/ and package.json; also scripts/ and .gitignore, not docs/missing.md, ../etc/passwd, or the scripts word alone.",
    ),
  ).toEqual(["apps/cli/src/query.ts", "apps/cli", "package.json", "scripts", ".gitignore"]);
});

it("weights canonical documents by how many target paths they name", async () => {
  const path = await root();
  expect(await governingPreference(path, ["apps/cli/src/query.ts"])).toEqual([]);
  await writeGoverningIndex(path, {
    documents: ["docs/a.md", "docs/b.md"],
    entries: { "apps/cli/src/query.ts": [0, 1], "package.json": [0] },
    truncated: [],
  });
  expect(
    (await governingPreference(path, ["apps/cli/src/query.ts", "package.json"])).sort((l, r) =>
      l.path < r.path ? -1 : 1,
    ),
  ).toEqual([
    { path: "docs/a.md", weight: 2 },
    { path: "docs/b.md", weight: 1 },
  ]);
});
