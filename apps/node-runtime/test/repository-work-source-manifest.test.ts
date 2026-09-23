import { describe, expect, it } from "vitest";

import {
  parseRepositoryWorkSourceManifest,
  prepareRepositoryWorkSourceManifest,
} from "../src/repository-work-source-manifest.js";

const before = {
  head: "a".repeat(40),
  paths: new Map([["src/dirty.ts", `file:33188:${"b".repeat(64)}`]]),
  revision: `sha256:${"c".repeat(64)}`,
};
const after = {
  head: "d".repeat(40),
  paths: new Map([["src/dirty.ts", `file:33188:${"e".repeat(64)}`]]),
  revision: `sha256:${"f".repeat(64)}`,
};

describe("repository work source manifest", () => {
  it("binds dirty bytes and clean Git paths without storing source content", () => {
    const prepared = prepareRepositoryWorkSourceManifest({
      before,
      after,
      change: {
        repositoryRevisionBefore: before.revision,
        repositoryRevisionAfter: after.revision,
        changedPaths: ["src/dirty.ts", "src/committed.ts"],
      },
    });

    expect(prepared.manifest.paths).toEqual([
      {
        path: "src/committed.ts",
        before: { kind: "git_tree", commit: before.head },
        after: { kind: "git_tree", commit: after.head },
      },
      {
        path: "src/dirty.ts",
        before: { kind: "working_tree", digest: before.paths.get("src/dirty.ts") },
        after: { kind: "working_tree", digest: after.paths.get("src/dirty.ts") },
      },
    ]);
    expect(prepared.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(parseRepositoryWorkSourceManifest(prepared.content)).toEqual(prepared.manifest);
    expect(new TextDecoder().decode(prepared.content)).not.toContain("source body");
  });

  it("rejects stale revisions, duplicate paths, and unobserved changes", () => {
    const change = {
      repositoryRevisionBefore: before.revision,
      repositoryRevisionAfter: after.revision,
      changedPaths: ["src/dirty.ts"],
    };
    expect(() =>
      prepareRepositoryWorkSourceManifest({
        before,
        after,
        change: { ...change, repositoryRevisionAfter: before.revision },
      }),
    ).toThrowError(expect.objectContaining({ code: "repository_source_manifest_invalid" }));
    expect(() =>
      prepareRepositoryWorkSourceManifest({
        before,
        after,
        change: { ...change, changedPaths: ["src/dirty.ts", "src/dirty.ts"] },
      }),
    ).toThrowError(expect.objectContaining({ code: "repository_source_manifest_invalid" }));
    expect(() =>
      prepareRepositoryWorkSourceManifest({
        before,
        after: before,
        change: { ...change, repositoryRevisionAfter: before.revision },
      }),
    ).toThrowError(expect.objectContaining({ code: "repository_source_manifest_invalid" }));
  });

  it("rejects malformed, noncanonical, and traversal source evidence", () => {
    const prepared = prepareRepositoryWorkSourceManifest({
      before,
      after,
      change: {
        repositoryRevisionBefore: before.revision,
        repositoryRevisionAfter: after.revision,
        changedPaths: ["src/dirty.ts"],
      },
    });
    expect(() =>
      parseRepositoryWorkSourceManifest(
        Buffer.from(` ${new TextDecoder().decode(prepared.content)}`),
      ),
    ).toThrowError(expect.objectContaining({ code: "repository_source_manifest_invalid" }));
    const unsafe = structuredClone(prepared.manifest);
    unsafe.paths[0]!.path = "../secret.txt";
    expect(() =>
      parseRepositoryWorkSourceManifest(Buffer.from(JSON.stringify(unsafe))),
    ).toThrowError(expect.objectContaining({ code: "repository_source_manifest_invalid" }));
    const malformed = structuredClone(prepared.manifest);
    malformed.paths[0]!.after = { kind: "working_tree", digest: "file:bad" };
    expect(() =>
      parseRepositoryWorkSourceManifest(Buffer.from(JSON.stringify(malformed))),
    ).toThrowError(expect.objectContaining({ code: "repository_source_manifest_invalid" }));
  });
});
