import { execFile } from "node:child_process";

import { CommandFailure } from "./command-error-output.js";

/** What a host reads about one published release before it downloads anything. */
export interface PublishedReleaseListing {
  tag: string;
  draft: boolean;
  prerelease: boolean;
  assetNames: string[];
}

/**
 * ADR-0571: the port through which a host learns about and fetches a published release. Every
 * read names one exact tag or commit, so a moving tag can only make verification fail.
 */
export interface HostReleaseSource {
  readonly repository: string;
  readRelease(tag: string): Promise<PublishedReleaseListing>;
  /** The commit and tree the tag points at, following an annotated tag to its commit. */
  resolveTag(tag: string): Promise<{ sha: string; tree: string }>;
  readCommittedFile(commit: string, path: string): Promise<Buffer>;
  /** Downloads every asset of the release into an existing empty directory. */
  downloadAssets(tag: string, directory: string): Promise<void>;
}

/** Runs the GitHub CLI and returns its standard output bytes; rejects on a non-zero exit. */
export type GhRunner = (args: readonly string[]) => Promise<Buffer>;

const maximumGhOutputBytes = 8 * 1024 * 1024;
const ghTimeoutMilliseconds = 5 * 60_000;
const objectIdPattern = /^[a-f0-9]{40}$/u;

export const runGh: GhRunner = (args) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      "gh",
      [...args],
      {
        encoding: "buffer",
        maxBuffer: maximumGhOutputBytes,
        timeout: ghTimeoutMilliseconds,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
      },
      (error, stdout) => (error === null ? resolvePromise(stdout) : reject(error)),
    );
  });

function unavailable(repository: string, what: string): CommandFailure {
  // The GitHub CLI's own error text can name credentials or hosts; only the coordinate is kept.
  return new CommandFailure(
    "host_release_unavailable",
    `Could not read ${what} of ${repository} through the GitHub CLI. Check that gh is installed and authenticated on this host.`,
    { repository },
  );
}

function parseObject(contents: Buffer): Record<string, unknown> | null {
  try {
    const value = JSON.parse(contents.toString("utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The GitHub Releases adapter. It goes through `gh`, so credentials stay in the GitHub CLI's own
 * store and never pass through Lervo; the same command works on every host where `gh` works.
 */
export function createGhReleaseSource(
  repository: string,
  run: GhRunner = runGh,
): HostReleaseSource {
  const read = async (args: readonly string[], what: string): Promise<Buffer> => {
    try {
      return await run(args);
    } catch {
      throw unavailable(repository, what);
    }
  };
  const readObject = async (path: string, what: string): Promise<Record<string, unknown>> => {
    const value = parseObject(await read(["api", path], what));
    if (value === null) throw unavailable(repository, what);
    return value;
  };
  return {
    repository,
    async readRelease(tag) {
      const what = `release ${tag}`;
      const listing = parseObject(
        await read(
          [
            "release",
            "view",
            tag,
            "--repo",
            repository,
            "--json",
            "tagName,isDraft,isPrerelease,assets",
          ],
          what,
        ),
      );
      const assets = listing?.assets;
      if (
        listing === null ||
        typeof listing.tagName !== "string" ||
        typeof listing.isDraft !== "boolean" ||
        typeof listing.isPrerelease !== "boolean" ||
        !Array.isArray(assets) ||
        !assets.every((asset) => typeof (asset as { name?: unknown } | null)?.name === "string")
      )
        throw unavailable(repository, what);
      return {
        tag: listing.tagName,
        draft: listing.isDraft,
        prerelease: listing.isPrerelease,
        assetNames: assets.map((asset) => (asset as { name: string }).name),
      };
    },
    async resolveTag(tag) {
      const what = `tag ${tag}`;
      const reference = await readObject(`repos/${repository}/git/ref/tags/${tag}`, what);
      let object = reference.object as { type?: unknown; sha?: unknown } | undefined;
      // An annotated tag points at a tag object; follow it once to the commit.
      if (object?.type === "tag" && typeof object.sha === "string")
        object = (await readObject(`repos/${repository}/git/tags/${object.sha}`, what)).object as
          { type?: unknown; sha?: unknown } | undefined;
      if (
        object?.type !== "commit" ||
        typeof object.sha !== "string" ||
        !objectIdPattern.test(object.sha)
      )
        throw unavailable(repository, what);
      const commit = await readObject(`repos/${repository}/git/commits/${object.sha}`, what);
      const tree = (commit.tree as { sha?: unknown } | undefined)?.sha;
      if (typeof tree !== "string" || !objectIdPattern.test(tree))
        throw unavailable(repository, what);
      return { sha: object.sha, tree };
    },
    async readCommittedFile(commit, path) {
      return read(
        [
          "api",
          "-H",
          "Accept: application/vnd.github.raw+json",
          `repos/${repository}/contents/${path}?ref=${commit}`,
        ],
        `${path} at ${commit}`,
      );
    },
    async downloadAssets(tag, directory) {
      await read(
        ["release", "download", tag, "--repo", repository, "--dir", directory],
        `the assets of release ${tag}`,
      );
    },
  };
}
