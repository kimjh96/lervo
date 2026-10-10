import { expect, it } from "vitest";
import { tarListingLines } from "../../shared/tar-archive.mjs";
import { hubDistributionSafePath } from "../lib/hub-runtime-distribution-contract.mjs";
import { nodeDistributionSafePath } from "../lib/node-runtime-distribution-contract.mjs";

it.each(["\r\n", "\n"])("reads Windows tar line endings %j", (ending) => {
  const paths = tarListingLines(`dist/bin.js${ending}README.md${ending}`, "win32");
  expect(paths).toEqual(["dist/bin.js", "README.md"]);
  for (const safe of [hubDistributionSafePath, nodeDistributionSafePath])
    expect(paths.every(safe)).toBe(true);
});

it.each(["darwin", "linux"])("preserves unsafe trailing CR in %s tar paths", (platform) => {
  const paths = tarListingLines("dist/bin.js\r\n", platform);
  expect(paths).toEqual(["dist/bin.js\r"]);
  for (const safe of [hubDistributionSafePath, nodeDistributionSafePath])
    expect(safe(paths[0])).toBe(false);
});

it("retains embedded and extra CR, traversal, and duplicate Windows paths for rejection", () => {
  const paths = tarListingLines(
    "dist/bi\rn.js\r\nREADME.md\r\r\n../outside\r\ndist/bin.js\r\ndist/bin.js\r\n",
    "win32",
  );
  for (const safe of [hubDistributionSafePath, nodeDistributionSafePath]) {
    expect(paths.slice(0, 3).every((path) => !safe(path))).toBe(true);
  }
  expect(paths.slice(3)).toEqual(["dist/bin.js", "dist/bin.js"]);
});
