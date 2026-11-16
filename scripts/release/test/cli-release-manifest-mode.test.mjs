import { expect, it } from "vitest";

import { cliReleaseManifestMode } from "../lib/cli-release-manifest-mode.mjs";
import { classifyDependencies } from "../../shared/release-dependency-closure.mjs";

const approved = [{ prefix: "@vendor/native-", version: "1.0.0" }];
const installed = (version) =>
  new Map([
    ["portable@1.0.0", { name: "portable", version: "1.0.0" }],
    [
      `@vendor/native-linux-x64@${version}`,
      { name: "@vendor/native-linux-x64", version, os: ["linux"], cpu: ["x64"] },
    ],
  ]);
const classify = (args, version) => {
  const mode = cliReleaseManifestMode(args);
  return classifyDependencies(
    installed(version),
    mode.readCommitted ? approved : [],
    mode.inferFamilies,
  );
};

it("keeps the committed platform families when generating for an ordinary change", () => {
  expect(cliReleaseManifestMode(["--write", "--committed-families"])).toEqual({
    write: true,
    readCommitted: true,
    inferFamilies: false,
  });
  expect(classify(["--write", "--committed-families"], "1.0.0").platformSpecificFamilies).toEqual(
    approved,
  );
  // A new family, or a new version of one, fails exactly as the check does.
  for (const args of [["--write", "--committed-families"], []])
    expect(() => classify(args, "2.0.0")).toThrow("disallowed platform-specific dependency");
});

it("infers families only for release preparation's plain write", () => {
  expect(cliReleaseManifestMode(["--write"])).toEqual({
    write: true,
    readCommitted: false,
    inferFamilies: true,
  });
  expect(cliReleaseManifestMode([])).toEqual({
    write: false,
    readCommitted: true,
    inferFamilies: false,
  });
  expect(classify(["--write"], "2.0.0").platformSpecificFamilies).toEqual([
    { prefix: "@vendor/native-", version: "2.0.0" },
  ]);
});
