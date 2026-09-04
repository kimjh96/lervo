import { describe, expect, it } from "vitest";

import { sameRepositoryPathIdentity } from "../src/filesystem.js";

const openedIdentity = {
  dev: 2_564_934_428n,
  ino: 1_970_324_837_198_772n,
  size: 1n,
  mtimeNs: 1_788_539_644_239_488_300n,
  ctimeNs: 1_788_539_644_239_488_300n,
};

describe("repository file identity", () => {
  it("accepts an unavailable Windows path device while retaining all other checks", () => {
    expect(
      sameRepositoryPathIdentity({ ...openedIdentity, dev: 0n }, openedIdentity, "win32"),
    ).toBe(true);
    expect(
      sameRepositoryPathIdentity({ ...openedIdentity, dev: 0n }, openedIdentity, "linux"),
    ).toBe(false);
  });

  it.each(["ino", "size", "mtimeNs", "ctimeNs"] as const)(
    "rejects a Windows path whose %s changed",
    (field) => {
      expect(
        sameRepositoryPathIdentity(
          { ...openedIdentity, dev: 0n, [field]: openedIdentity[field] + 1n },
          openedIdentity,
          "win32",
        ),
      ).toBe(false);
    },
  );

  it("requires matching nonzero Windows device identifiers", () => {
    expect(
      sameRepositoryPathIdentity({ ...openedIdentity, dev: 7n }, openedIdentity, "win32"),
    ).toBe(false);
  });
});
