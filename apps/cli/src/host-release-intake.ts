import { rm } from "node:fs/promises";

import { CommandFailure } from "./command-error-output.js";
import { downloadReleaseSubjects, promoteReleaseSubjects } from "./host-cli-install.js";
import type { HostReleaseSource } from "./host-release-source.js";
import {
  COMMITTED_RELEASE_PATHS,
  RELEASE_SUBJECTS_BINDING,
  releaseSubjectNames,
  verifyPublishedRelease,
  type VerifiedRelease,
} from "./host-release-verification.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";

const tagPattern = /^v(\d+\.\d+\.\d+)$/u;
const canonicalJson = (value: unknown): string => JSON.stringify(value);

export interface PublishedRelease {
  version: string;
  commit: { sha: string; tree: string };
}

/**
 * ADR-0571 admission: only a published, non-draft, non-prerelease release with exactly the
 * verified subjects counts, so following a tag the owner never released is impossible.
 */
export async function readPublishedRelease(
  source: HostReleaseSource,
  tag: string,
): Promise<PublishedRelease> {
  const version = tagPattern.exec(tag)?.[1];
  if (version === undefined)
    throw new CommandFailure(
      "host_upgrade_arguments_invalid",
      `${tag} is not a v<major>.<minor>.<patch> tag.`,
    );
  const listing = await source.readRelease(tag);
  if (listing.tag !== tag)
    throw new CommandFailure(
      "host_release_unavailable",
      `The release source returned ${listing.tag} for ${tag}.`,
    );
  if (listing.draft || listing.prerelease)
    throw new CommandFailure(
      "host_release_not_published",
      `${tag} is a ${listing.draft ? "draft" : "prerelease"}; a host installs only published releases.`,
      { tag },
    );
  const expected = [...releaseSubjectNames(version), RELEASE_SUBJECTS_BINDING].sort();
  if (canonicalJson([...listing.assetNames].sort()) !== canonicalJson(expected))
    throw new CommandFailure(
      "host_release_assets_incomplete",
      `${tag} does not carry exactly the verified release subjects; releases before ADR-0569 have none.`,
      { tag, assets: listing.assetNames },
    );
  return { version, commit: await source.resolveTag(tag) };
}

/**
 * Downloads the release, verifies it against the exact commit the tag resolved to, and keeps it.
 * A download that fails verification is discarded before anything else happens.
 */
export async function intakeVerifiedRelease(
  source: HostReleaseSource,
  tag: string,
  layout: HostUpgradeLayout,
  commit: { sha: string; tree: string },
): Promise<{ release: VerifiedRelease; downloadDirectory: string }> {
  const downloaded = await downloadReleaseSubjects(layout, source, tag);
  let release: VerifiedRelease;
  try {
    const [manifest, sbom, packageManifest] = await Promise.all([
      source.readCommittedFile(commit.sha, COMMITTED_RELEASE_PATHS.manifest),
      source.readCommittedFile(commit.sha, COMMITTED_RELEASE_PATHS.sbom),
      source.readCommittedFile(commit.sha, COMMITTED_RELEASE_PATHS.packageManifest),
    ]);
    release = verifyPublishedRelease({
      tag,
      commit,
      bindingContents: downloaded.bindingContents,
      files: downloaded.files,
      committed: { manifest, sbom, packageManifest },
    });
  } catch (error) {
    await rm(downloaded.directory, { recursive: true, force: true });
    throw error;
  }
  return {
    release,
    downloadDirectory: await promoteReleaseSubjects(layout, downloaded.directory, release),
  };
}
