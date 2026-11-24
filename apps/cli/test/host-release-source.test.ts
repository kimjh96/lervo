import { describe, expect, it } from "vitest";

import { createGhReleaseSource, type GhRunner } from "../src/host-release-source.js";

const commit = "1".repeat(40);
const tagObject = "2".repeat(40);
const tree = "3".repeat(40);

function runner(responses: Record<string, unknown>, calls: string[][] = []): GhRunner {
  return async (args) => {
    calls.push([...args]);
    const key = args.join(" ");
    const match = Object.keys(responses).find((candidate) => key.includes(candidate));
    if (match === undefined) throw new Error(`gh: token ghp_secret rejected for ${key}`);
    const value = responses[match];
    return Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  };
}

describe("createGhReleaseSource", () => {
  it("follows an annotated tag to its commit and tree", async () => {
    const source = createGhReleaseSource(
      "owner/lervo",
      runner({
        "git/ref/tags/v1.2.3": { object: { type: "tag", sha: tagObject } },
        [`git/tags/${tagObject}`]: { object: { type: "commit", sha: commit } },
        [`git/commits/${commit}`]: { tree: { sha: tree } },
      }),
    );
    await expect(source.resolveTag("v1.2.3")).resolves.toEqual({ sha: commit, tree });
  });

  it("reads the release listing and committed bytes for one exact commit", async () => {
    const calls: string[][] = [];
    const source = createGhReleaseSource(
      "owner/lervo",
      runner(
        {
          "release view v1.2.3": {
            tagName: "v1.2.3",
            isDraft: false,
            isPrerelease: false,
            assets: [{ name: "a" }, { name: "b" }],
          },
          [`contents/apps/cli/package.json?ref=${commit}`]: Buffer.from("raw bytes"),
        },
        calls,
      ),
    );
    await expect(source.readRelease("v1.2.3")).resolves.toEqual({
      tag: "v1.2.3",
      draft: false,
      prerelease: false,
      assetNames: ["a", "b"],
    });
    await expect(source.readCommittedFile(commit, "apps/cli/package.json")).resolves.toEqual(
      Buffer.from("raw bytes"),
    );
    expect(calls[0]).toEqual([
      "release",
      "view",
      "v1.2.3",
      "--repo",
      "owner/lervo",
      "--json",
      "tagName,isDraft,isPrerelease,assets",
    ]);
    expect(calls[1]).toContain("Accept: application/vnd.github.raw+json");
  });

  it("lists releases with exact gh arguments and rejects a malformed list", async () => {
    const calls: string[][] = [];
    const source = createGhReleaseSource(
      "owner/lervo",
      runner(
        {
          "release list": [
            { tagName: "v1.2.4", isDraft: true, isPrerelease: false },
            { tagName: "v1.2.3", isDraft: false, isPrerelease: false },
          ],
        },
        calls,
      ),
    );
    await expect(source.listReleases()).resolves.toEqual([
      { tag: "v1.2.4", draft: true, prerelease: false },
      { tag: "v1.2.3", draft: false, prerelease: false },
    ]);
    expect(calls[0]).toEqual([
      "release",
      "list",
      "--repo",
      "owner/lervo",
      "--limit",
      "30",
      "--json",
      "tagName,isDraft,isPrerelease",
    ]);
    const malformed = createGhReleaseSource(
      "owner/lervo",
      runner({ "release list": [{ tagName: "v1.2.3" }] }),
    );
    await expect(malformed.listReleases()).rejects.toMatchObject({
      code: "host_release_unavailable",
    });
    const failing = createGhReleaseSource("owner/lervo", runner({}));
    const failure = await failing.listReleases().catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "host_release_unavailable" });
    expect(String((failure as Error).message)).not.toContain("ghp_secret");
  });

  it("widens the list when ADE releases fill the newest page, so the newest CLI release stays", async () => {
    const ade = Array.from({ length: 30 }, (_, index) => ({
      tagName: `ade-v0.${30 - index}.0`,
      isDraft: false,
      isPrerelease: false,
    }));
    const cli = { tagName: "v1.2.3", isDraft: false, isPrerelease: false };
    const calls: string[][] = [];
    const source = createGhReleaseSource(
      "owner/lervo",
      runner({ "--limit 30 ": ade, "--limit 300 ": [...ade, cli] }, calls),
    );
    const releases = await source.listReleases();
    expect(releases).toHaveLength(31);
    expect(releases.at(-1)).toEqual({ tag: "v1.2.3", draft: false, prerelease: false });
    expect(calls.map((call) => call[5])).toEqual(["30", "300"]);
  });

  it("keeps the newest page when it holds a published CLI release or is the whole list", async () => {
    const page = [
      ...Array.from({ length: 29 }, (_, index) => ({
        tagName: `ade-v0.${29 - index}.0`,
        isDraft: false,
        isPrerelease: false,
      })),
      { tagName: "v1.2.3", isDraft: false, isPrerelease: false },
    ];
    const calls: string[][] = [];
    const full = createGhReleaseSource("owner/lervo", runner({ "release list": page }, calls));
    await expect(full.listReleases()).resolves.toHaveLength(30);
    const short = createGhReleaseSource(
      "owner/lervo",
      runner({ "release list": page.slice(0, 5) }, calls),
    );
    await expect(short.listReleases()).resolves.toHaveLength(5);
    expect(calls).toHaveLength(2);
  });

  it("widens past a newest page whose only CLI release is a draft", async () => {
    const page = [
      { tagName: "v1.2.4", isDraft: true, isPrerelease: false },
      ...Array.from({ length: 29 }, (_, index) => ({
        tagName: `ade-v0.${29 - index}.0`,
        isDraft: false,
        isPrerelease: false,
      })),
    ];
    const calls: string[][] = [];
    const source = createGhReleaseSource(
      "owner/lervo",
      runner({ "--limit 30 ": page, "--limit 300 ": page }, calls),
    );
    await source.listReleases();
    expect(calls.map((call) => call[5])).toEqual(["30", "300"]);
  });

  it("translates a gh failure without its output, which can name credentials", async () => {
    const source = createGhReleaseSource("owner/lervo", runner({}));
    const failure = await source.resolveTag("v1.2.3").catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "host_release_unavailable" });
    expect(String((failure as Error).message)).not.toContain("ghp_secret");
  });

  it("rejects a tag that does not lead to a commit", async () => {
    const source = createGhReleaseSource(
      "owner/lervo",
      runner({ "git/ref/tags/v1.2.3": { object: { type: "tree", sha: tree } } }),
    );
    await expect(source.resolveTag("v1.2.3")).rejects.toMatchObject({
      code: "host_release_unavailable",
    });
  });
});
