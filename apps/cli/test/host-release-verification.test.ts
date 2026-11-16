import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readNpmTarballEntries } from "../src/host-release-tarball.js";
import {
  verifyPublishedRelease,
  type PublishedReleaseEvidence,
} from "../src/host-release-verification.js";
import { releaseFixture, ustarArchive, type ReleaseFixture } from "./host-release-fixture.js";

const sha256 = (contents: Buffer) =>
  `sha256:${createHash("sha256").update(contents).digest("hex")}`;

function evidence(fixture: ReleaseFixture): PublishedReleaseEvidence {
  const files = new Map(fixture.assets);
  const bindingContents = files.get("release-subjects.json") as Buffer;
  files.delete("release-subjects.json");
  return {
    tag: fixture.tag,
    commit: { sha: fixture.commit, tree: fixture.tree },
    bindingContents,
    files,
    committed: {
      manifest: fixture.committed.get("apps/cli/release-artifact-manifest.json") as Buffer,
      sbom: fixture.committed.get("apps/cli/release-sbom.cdx.json") as Buffer,
      packageManifest: fixture.committed.get("apps/cli/package.json") as Buffer,
    },
  };
}

/** Replaces one subject and rebinds it, as a consistent but wrong release would look. */
function rebind(
  base: PublishedReleaseEvidence,
  name: string,
  contents: Buffer,
): PublishedReleaseEvidence {
  const files = new Map(base.files);
  files.set(name, contents);
  const binding = JSON.parse(base.bindingContents.toString("utf8")) as {
    files: { name: string; size: number; sha256: string }[];
  };
  binding.files = binding.files.map((file) =>
    file.name === name ? { name, size: contents.length, sha256: sha256(contents) } : file,
  );
  return { ...base, files, bindingContents: Buffer.from(JSON.stringify(binding)) };
}

function failureCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("verifyPublishedRelease", () => {
  it("accepts the bound subjects of the tag's tree and returns the runtime dependencies", () => {
    const fixture = releaseFixture({ dependencies: { zod: "4.4.3" } });
    const verified = verifyPublishedRelease(evidence(fixture));
    expect(verified).toMatchObject({
      tag: "v9.9.9",
      version: "9.9.9",
      commit: fixture.commit,
      tree: fixture.tree,
      tarballName: "lervo-cli-9.9.9.tgz",
      dependencies: { zod: "4.4.3" },
    });
    expect(verified.tarballSha256).toBe(
      sha256(fixture.assets.get("lervo-cli-9.9.9.tgz") as Buffer),
    );
  });

  it("rejects subjects bound to another tag or another tree", () => {
    const base = evidence(releaseFixture());
    expect(failureCode(() => verifyPublishedRelease({ ...base, tag: "v9.9.8" }))).toBe(
      "release_subjects_tag_mismatch",
    );
    expect(
      failureCode(() =>
        verifyPublishedRelease({ ...base, commit: { sha: "c".repeat(40), tree: "f".repeat(40) } }),
      ),
    ).toBe("release_subjects_tree_mismatch");
  });

  it("rejects a malformed binding, a changed subject, and an extra file", () => {
    const base = evidence(releaseFixture());
    expect(
      failureCode(() => verifyPublishedRelease({ ...base, bindingContents: Buffer.from("{}") })),
    ).toBe("release_subjects_binding_invalid");
    const files = new Map(base.files);
    files.set("release-sbom.cdx.json", Buffer.from("{}\n"));
    expect(failureCode(() => verifyPublishedRelease({ ...base, files }))).toBe(
      "release_subjects_digest_mismatch",
    );
    const extra = new Map(base.files);
    extra.set("notes.txt", Buffer.from("x"));
    expect(failureCode(() => verifyPublishedRelease({ ...base, files: extra }))).toBe(
      "release_subjects_file_set_mismatch",
    );
  });

  it("rejects metadata that differs from the tag's committed bytes, even when consistently bound", () => {
    const base = evidence(releaseFixture());
    const changed = rebind(base, "release-sbom.cdx.json", Buffer.from('{"bomFormat":"other"}\n'));
    expect(failureCode(() => verifyPublishedRelease(changed))).toBe(
      "release_subjects_metadata_mismatch",
    );
  });

  it("rejects a consistently bound tarball whose files differ from the committed manifest", () => {
    const fixture = releaseFixture();
    const base = evidence(fixture);
    const entries = [
      ...readNpmTarballEntries(fixture.assets.get("lervo-cli-9.9.9.tgz") as Buffer),
    ].map(([path, contents]): [string, Buffer] => [`package/${path}`, contents]);
    const extraFile = ustarArchive([...entries, ["package/dist/extra.js", Buffer.from("x")]]);
    expect(
      failureCode(() => verifyPublishedRelease(rebind(base, "lervo-cli-9.9.9.tgz", extraFile))),
    ).toBe("release_subjects_archive_mismatch");
  });

  it("rejects a tarball package manifest whose scripts differ from the released tree", () => {
    const fixture = releaseFixture();
    const base = evidence(fixture);
    const entries = [
      ...readNpmTarballEntries(fixture.assets.get("lervo-cli-9.9.9.tgz") as Buffer),
    ].map(([path, contents]): [string, Buffer] => {
      if (path !== "package.json") return [`package/${path}`, contents];
      const manifest = JSON.parse(contents.toString("utf8")) as Record<string, unknown>;
      return [
        "package/package.json",
        Buffer.from(JSON.stringify({ ...manifest, scripts: { postinstall: "node evil.js" } })),
      ];
    });
    expect(
      failureCode(() =>
        verifyPublishedRelease(rebind(base, "lervo-cli-9.9.9.tgz", ustarArchive(entries))),
      ),
    ).toBe("release_subjects_package_manifest_mismatch");
  });

  it("rejects an unresolved workspace range in the packed manifest", () => {
    const fixture = releaseFixture();
    const base = evidence(fixture);
    const entries = [
      ...readNpmTarballEntries(fixture.assets.get("lervo-cli-9.9.9.tgz") as Buffer),
    ].map(([path, contents]): [string, Buffer] => {
      if (path !== "package.json") return [`package/${path}`, contents];
      const manifest = JSON.parse(contents.toString("utf8")) as Record<string, unknown>;
      return [
        "package/package.json",
        Buffer.from(
          JSON.stringify({ ...manifest, devDependencies: { "@lervo/core": "workspace:*" } }),
        ),
      ];
    });
    expect(
      failureCode(() =>
        verifyPublishedRelease(rebind(base, "lervo-cli-9.9.9.tgz", ustarArchive(entries))),
      ),
    ).toBe("release_subjects_package_manifest_mismatch");
  });
});

describe("verifyPublishedRelease dependency contract", () => {
  it("returns the committed manifest's closure", () => {
    const verified = verifyPublishedRelease(evidence(releaseFixture({ portable: ["zod@4.4.3"] })));
    expect(verified.dependencyClosure).toEqual({ portable: ["zod@4.4.3"], platformFamilies: [] });
  });

  it("rejects a workspace range resolved outside devDependencies", () => {
    const fixture = releaseFixture({ dependencies: { "@lervo/core": "workspace:*" } });
    const base = evidence(fixture);
    const entries = [
      ...readNpmTarballEntries(fixture.assets.get("lervo-cli-9.9.9.tgz") as Buffer),
    ].map(([path, contents]): [string, Buffer] => {
      if (path !== "package.json") return [`package/${path}`, contents];
      const manifest = JSON.parse(contents.toString("utf8")) as Record<string, unknown>;
      return [
        "package/package.json",
        Buffer.from(JSON.stringify({ ...manifest, dependencies: { "@lervo/core": "6.6.6" } })),
      ];
    });
    expect(
      failureCode(() =>
        verifyPublishedRelease(rebind(base, "lervo-cli-9.9.9.tgz", ustarArchive(entries))),
      ),
    ).toBe("release_subjects_package_manifest_mismatch");
  });
});

describe("readNpmTarballEntries", () => {
  it("rejects paths outside package/ and duplicate entries", () => {
    expect(() => readNpmTarballEntries(ustarArchive([["other/file", Buffer.from("x")]]))).toThrow(
      /tarball is invalid/u,
    );
    expect(() =>
      readNpmTarballEntries(
        ustarArchive([
          ["package/a", Buffer.from("x")],
          ["package/a", Buffer.from("y")],
        ]),
      ),
    ).toThrow(/tarball is invalid/u);
    expect(() => readNpmTarballEntries(ustarArchive([["package/../a", Buffer.from("x")]]))).toThrow(
      /tarball is invalid/u,
    );
  });

  it("reads a pax path record and rejects any other pax key or a global header", () => {
    const pax = (record: string) => {
      const line = ` ${record}\n`;
      let length = line.length + 2;
      while (`${length}${line}`.length !== length) length += 1;
      return Buffer.from(`${length}${line}`);
    };
    const longPath = `package/${"d/".repeat(60)}file.js`;
    expect([
      ...readNpmTarballEntries(
        ustarArchive([
          ["PaxHeader", pax(`path=${longPath}`), "x"],
          ["truncated", Buffer.from("x")],
        ]),
      ).keys(),
    ]).toEqual([longPath.slice("package/".length)]);
    for (const record of ["size=1", "linkpath=/etc/passwd", "mtime=1"])
      expect(() =>
        readNpmTarballEntries(
          ustarArchive([
            ["PaxHeader", pax(record), "x"],
            ["package/a", Buffer.from("x")],
          ]),
        ),
      ).toThrow(/tarball is invalid/u);
    expect(() =>
      readNpmTarballEntries(
        ustarArchive([
          ["GlobalHead", pax("comment=x"), "g"],
          ["package/a", Buffer.from("x")],
        ]),
      ),
    ).toThrow(/tarball is invalid/u);
  });
});
