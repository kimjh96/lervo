import { randomBytes } from "node:crypto";
import { delimiter, resolve } from "node:path";
import { lstat } from "node:fs/promises";

import {
  inspectHostLinks,
  packageLinkTargets,
  readActivationJournal,
  readHostLinks,
  withHostUpgradeLock,
  type HostActivationRecord,
  type HostLinkChange,
  type HostLinkState,
} from "./host-cli-activation.js";
import {
  installedPackageRoot,
  installReleasePackage,
  releaseInstallDirectory,
  type HostCliInstaller,
} from "./host-cli-install.js";
import { intakeVerifiedRelease, readPublishedRelease } from "./host-release-intake.js";
import {
  activateLinks,
  reconcilePendingActivations,
  type HostCliProbes,
} from "./host-link-activation.js";
import {
  activationReferences,
  pruneHostReleases,
  referencedReleaseDirectories,
} from "./host-release-retention.js";
import type { HostReleaseSource } from "./host-release-source.js";
import { HOST_CLI_LINKS, type HostUpgradeLayout } from "./host-upgrade-layout.js";

export interface HostUpgradeDependencies {
  layout: HostUpgradeLayout;
  installer: HostCliInstaller;
  probes: HostCliProbes;
  now: () => Date;
  newActivationId: () => string;
  /** The install root ADR-0488's `current` pointer names, which pruning must keep. */
  readCliPointer: () => Promise<string | null>;
}

export interface HostReleasePlan {
  status: "ready" | "current";
  repository: string;
  tag: string;
  version: string;
  commit: string;
  tree: string;
  installDirectory: string;
  links: HostLinkChange[];
  /** An earlier `lervo` on PATH that would still run instead of the activated link, if any. */
  pathShadow: string | null;
}

export type HostUpgradeResult = { reconciledActivations: string[] } & (
  | (Omit<HostReleasePlan, "pathShadow"> & { status: "current"; reusedInstall: boolean })
  | {
      status: "activated";
      activation: HostActivationRecord;
      reusedInstall: boolean;
      pruned: string[];
    }
);

export function newHostActivationId(): string {
  return `hact_${randomBytes(12).toString("hex")}`;
}

function linkChanges(
  layout: HostUpgradeLayout,
  current: ReadonlyMap<string, string | null>,
  targets: ReadonlyMap<string, string | null>,
): HostLinkChange[] {
  return HOST_CLI_LINKS.map(({ name }) => ({
    name,
    path: resolve(layout.binDirectory, name),
    previous: current.get(name) ?? null,
    current: targets.get(name) ?? null,
  }));
}

const unchanged = (changes: HostLinkChange[]) =>
  changes.every((change) => change.previous === change.current);

/**
 * The first `lervo` on PATH when it is not the managed link: activation would then not change
 * what a shell runs. A bin directory missing from PATH reports null too, since nothing shadows it.
 */
export async function findPathShadow(
  layout: HostUpgradeLayout,
  pathEnvironment: string | undefined,
): Promise<string | null> {
  const managed = resolve(layout.binDirectory, "lervo");
  for (const directory of (pathEnvironment ?? "").split(delimiter)) {
    if (directory === "") continue;
    const candidate = resolve(directory, "lervo");
    if (candidate === managed) return null;
    if ((await lstat(candidate).catch(() => null)) !== null) return candidate;
  }
  return null;
}

/** Read-only: what applying `tag` would install and which links it would switch. */
export async function planReleaseUpgrade(
  source: HostReleaseSource,
  tag: string,
  dependencies: Pick<HostUpgradeDependencies, "layout"> & { pathEnvironment?: string | undefined },
): Promise<HostReleasePlan> {
  const { layout } = dependencies;
  const { version, commit } = await readPublishedRelease(source, tag);
  const installDirectory = releaseInstallDirectory(layout, { version, commit: commit.sha });
  // Activation names the package's physical root, which exists only after the install; before
  // that, the plan names the stable path pnpm links it at.
  const root =
    (await installedPackageRoot(installDirectory)) ??
    resolve(installDirectory, "node_modules", "@lervo", "cli");
  const links = linkChanges(layout, await readHostLinks(layout), packageLinkTargets(root));
  return {
    status: unchanged(links) ? "current" : "ready",
    repository: source.repository,
    tag,
    version,
    commit: commit.sha,
    tree: commit.tree,
    installDirectory,
    links,
    pathShadow: await findPathShadow(layout, dependencies.pathEnvironment),
  };
}

/** Downloads, verifies, installs, switches, health-checks, and records one published release. */
export async function applyReleaseUpgrade(
  source: HostReleaseSource,
  tag: string,
  dependencies: HostUpgradeDependencies,
): Promise<HostUpgradeResult> {
  const { layout } = dependencies;
  return withHostUpgradeLock(layout, async () => {
    const reconciledActivations = await reconcilePendingActivations(layout);
    const { commit } = await readPublishedRelease(source, tag);
    const { release, downloadDirectory } = await intakeVerifiedRelease(source, tag, layout, commit);
    const install = await installReleasePackage({
      layout,
      release,
      tarballPath: resolve(downloadDirectory, release.tarballName),
      installer: dependencies.installer,
    });
    const links = linkChanges(
      layout,
      await readHostLinks(layout),
      packageLinkTargets(install.packageRoot),
    );
    if (unchanged(links))
      return {
        status: "current",
        repository: source.repository,
        tag,
        version: release.version,
        commit: release.commit,
        tree: release.tree,
        installDirectory: install.installDirectory,
        links,
        reusedInstall: install.reused,
        reconciledActivations,
      };
    const record: HostActivationRecord = {
      activationId: dependencies.newActivationId(),
      kind: "release",
      outcome: "pending",
      activatedAt: dependencies.now().toISOString(),
      links,
      release: {
        repository: source.repository,
        tag,
        version: release.version,
        commit: release.commit,
        tree: release.tree,
        tarballSha256: release.tarballSha256,
        installDirectory: install.installDirectory,
        downloadDirectory,
      },
    };
    const expected = new RegExp(`^lervo ${release.version.replaceAll(".", "\\.")}$`, "u");
    const journal = await activateLinks(layout, dependencies.probes, record, expected);
    const referenced = await referencedReleaseDirectories(layout, [
      ...(await readHostLinks(layout)).values(),
      await dependencies.readCliPointer(),
      ...activationReferences(journal),
    ]);
    const pruned = await pruneHostReleases(layout, referenced);
    return {
      status: "activated",
      activation: journal.find((entry) => entry.activationId === record.activationId) ?? record,
      reusedInstall: install.reused,
      pruned,
      reconciledActivations,
    };
  });
}

export async function hostUpgradeStatus(layout: HostUpgradeLayout): Promise<{
  links: HostLinkState[];
  activations: HostActivationRecord[];
}> {
  return {
    links: await inspectHostLinks(layout),
    activations: await readActivationJournal(layout),
  };
}
