import { expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { disclosePracticeCatalog } from "../src/practice-catalog.js";

it("keeps a large scanner inventory and read-root coordinates out of provider context", () => {
  const catalog = {
    digest: sha256("catalog"),
    complete: true,
    skills: [],
    rules: [],
    readRoots: ["private-work"],
    readablePaths: Array.from({ length: 7000 }, (_, i) => `private-work/source-${i}.ts`),
  };
  const disclosed = disclosePracticeCatalog(catalog);
  expect(disclosed).toEqual({ digest: catalog.digest, complete: true, skills: [], rules: [] });
  expect(Buffer.byteLength(JSON.stringify(disclosed))).toBeLessThan(1024);
  expect(JSON.stringify(disclosed)).not.toContain("private-work");
});
