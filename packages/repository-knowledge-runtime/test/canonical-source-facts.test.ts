import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { canonicalSourceFacts } from "../src/canonical-source-facts.js";
import { canonicalReleaseManifestFacts } from "../src/canonical-release-manifest-facts.js";

it("checks every component reference in the exact current CLI SBOM", async () => {
  const content = await readFile("apps/cli/release-sbom.cdx.json", "utf8");
  const [facts] = canonicalSourceFacts([
    {
      path: "apps/cli/release-sbom.cdx.json",
      contentHash: sha256(content),
      kind: "text",
      content,
    },
  ]);
  expect(facts).toMatchObject({
    contentHash: sha256(content),
    format: "CycloneDX",
    missingComponentReferences: [],
    missingDependencyNodeReferences: [],
  });
  expect(facts?.componentCount).toBeGreaterThan(200);
  expect(facts?.referencedComponentCount).toBeGreaterThan(200);
});

it("reports an actual dangling reference without guessing from a partial inventory", () => {
  const content = JSON.stringify({
    bomFormat: "CycloneDX",
    metadata: { component: { "bom-ref": "root" } },
    components: [{ "bom-ref": "present" }],
    dependencies: [{ ref: "root", dependsOn: ["present", "missing"] }],
  });
  expect(
    canonicalSourceFacts([
      { path: "inventory.cdx.json", contentHash: sha256(content), kind: "text", content },
    ]),
  ).toMatchObject([
    { missingComponentReferences: ["missing"], missingDependencyNodeReferences: [] },
  ]);
});

it("binds the archived CLI guide to its complete captured README bytes", async () => {
  const manifestPath = "apps/cli/release-artifact-manifest.json";
  const readmePath = "apps/cli/README.md";
  const [manifest, readme] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(readmePath, "utf8"),
  ]);
  const input = {
    repositoryRoot: process.cwd(),
    sources: [
      {
        path: manifestPath,
        contentHash: sha256(manifest),
        kind: "text" as const,
        content: manifest,
      },
    ],
    capturedSources: [{ path: readmePath, contentHash: sha256(readme) }],
  };
  const [facts] = canonicalReleaseManifestFacts(input);
  expect(facts?.archivedReadme).toMatchObject({
    path: readmePath,
    contentHash: sha256(readme),
    byteCount: Buffer.byteLength(readme),
    matchesManifest: true,
    content: readme,
  });
  const changed = JSON.parse(manifest) as {
    archive: { files: { path: string; sha256: string }[] };
  };
  changed.archive.files.find((item) => item.path === "README.md")!.sha256 =
    "sha256:" + "0".repeat(64);
  const inconsistent = JSON.stringify(changed);
  expect(
    canonicalReleaseManifestFacts({
      ...input,
      sources: [
        {
          path: manifestPath,
          contentHash: sha256(inconsistent),
          kind: "text",
          content: inconsistent,
        },
      ],
    })[0]?.archivedReadme.matchesManifest,
  ).toBe(false);
});
