import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";

import { parseSmokeTarballSource, smokeTarball } from "../lib/smoke-tarball-source.mjs";

const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("packed smoke tarball source", () => {
  it("parses only an absolute release subject directory", () => {
    assert.deepEqual(parseSmokeTarballSource([]), { releaseSubjects: null });
    assert.deepEqual(parseSmokeTarballSource(["--release-subjects", "/tmp/subjects"]), {
      releaseSubjects: "/tmp/subjects",
    });
    for (const args of [["--release-subjects"], ["--release-subjects", "subjects"], ["--pack"]])
      assert.throws(
        () => parseSmokeTarballSource(args),
        (error) => error.code === "smoke_tarball_source_invalid",
      );
  });

  it("installs the bound subject file itself and never packs again", async () => {
    const subjects = await mkdtemp(resolve(tmpdir(), "lervo-smoke-subjects-"));
    roots.push(subjects);
    await writeFile(resolve(subjects, "lervo-cli-1.2.3.tgz"), "bytes");
    const pack = () => assert.fail("a bound release must not be packed again");
    assert.equal(
      await smokeTarball({
        archiveRoot: "/unused",
        version: "1.2.3",
        releaseSubjects: subjects,
        pack,
      }),
      resolve(subjects, "lervo-cli-1.2.3.tgz"),
    );
    await assert.rejects(
      smokeTarball({ archiveRoot: "/unused", version: "1.2.4", releaseSubjects: subjects, pack }),
      (error) => error.code === "smoke_tarball_missing",
    );
  });

  it("packs the current build when no release subjects are given", async () => {
    const calls = [];
    const pack = async (archiveRoot, version) => {
      calls.push([archiveRoot, version]);
      return "/archive/lervo-cli-1.2.3.tgz";
    };
    assert.equal(
      await smokeTarball({
        archiveRoot: "/archive",
        version: "1.2.3",
        releaseSubjects: null,
        pack,
      }),
      "/archive/lervo-cli-1.2.3.tgz",
    );
    assert.deepEqual(calls, [["/archive", "1.2.3"]]);
  });
});
