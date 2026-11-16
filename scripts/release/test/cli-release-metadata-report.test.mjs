import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { describeCliReleaseMetadataChange } from "../lib/cli-release-metadata-report.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const committed = async () => ({
  committedManifest: JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json"), "utf8"),
  ),
  committedSbom: JSON.parse(
    await readFile(resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json"), "utf8"),
  ),
});

it("reports that matching metadata needs nothing", async () => {
  const { committedManifest, committedSbom } = await committed();
  expect(
    describeCliReleaseMetadataChange({
      committedManifest,
      generatedManifest: structuredClone(committedManifest),
      committedSbom,
      generatedSbom: structuredClone(committedSbom),
    }),
  ).toBe("### CLI release metadata\n\nThe committed manifest and SBOM match this build.\n");
});

it("names changed sections, packaged files, and coordinates without contents", async () => {
  const { committedManifest, committedSbom } = await committed();
  const generatedManifest = structuredClone(committedManifest);
  const bundle = generatedManifest.archive.files.find(({ path }) => path === "dist/bin.js");
  bundle.size += 1;
  bundle.sha256 = `sha256:${"1".repeat(64)}`;
  generatedManifest.bundle.workspacePackages = [
    ...generatedManifest.bundle.workspacePackages,
    "@lervo/new-package@0.1.0",
  ].sort();
  const [removed] = generatedManifest.dependencies.portable.splice(0, 1);
  generatedManifest.dependencies.portable.push("zz-added@1.0.0");
  generatedManifest.directDependencies = [
    ...generatedManifest.directDependencies,
    "zz-direct@1.0.0",
  ];
  const [family] = generatedManifest.dependencies.platformSpecificFamilies;
  generatedManifest.dependencies.platformSpecificFamilies = [{ ...family, version: "99.0.0" }];
  const generatedSbom = structuredClone(committedSbom);
  generatedSbom.components.pop();
  const report = describeCliReleaseMetadataChange({
    releaseMetadata: "generated",
    committedManifest,
    generatedManifest,
    committedSbom,
    generatedSbom,
  });
  expect(report).toContain("needs no metadata commit");
  for (const releaseMetadata of ["exact", undefined]) {
    const exact = describeCliReleaseMetadataChange({
      releaseMetadata,
      committedManifest,
      generatedManifest,
      committedSbom,
      generatedSbom,
    });
    expect(exact).toContain("Commit the generated files.");
    expect(exact).not.toContain("needs no metadata commit");
  }
  expect(report).toContain(
    "- Manifest sections: directDependencies, bundle, archive, dependencies",
  );
  expect(report).toContain("- `+ zz-direct@1.0.0`");
  expect(report).toContain(`- \`+ ${family.prefix}*@99.0.0\``);
  expect(report).toContain(`- \`- ${family.prefix}*@${family.version}\``);
  expect(report).toContain(
    `- SBOM components: ${committedSbom.components.length} → ${committedSbom.components.length - 1}`,
  );
  expect(report).toMatch(
    /- `dist\/bin\.js expected=\d+\/sha256:[a-f0-9]{64} actual=\d+\/sha256:1{64}`/u,
  );
  expect(report).toContain("- `+ @lervo/new-package@0.1.0`");
  expect(report).toContain("- `+ zz-added@1.0.0`");
  expect(report).toContain(`- \`- ${removed}\``);
  expect(report).not.toContain(committedSbom.serialNumber);
});

it("bounds every list", async () => {
  const { committedManifest, committedSbom } = await committed();
  const generatedManifest = structuredClone(committedManifest);
  generatedManifest.dependencies.portable = Array.from(
    { length: 45 },
    (_, index) => `added-${index}@1.0.0`,
  );
  const report = describeCliReleaseMetadataChange({
    committedManifest,
    generatedManifest,
    committedSbom,
    generatedSbom: committedSbom,
  });
  expect(report).toContain("(unchanged)");
  const listed = report.split("\n").filter((line) => line.startsWith("- `"));
  expect(listed).toHaveLength(40);
  expect(report).toMatch(/- \d+ more; see the uploaded files/u);
});
