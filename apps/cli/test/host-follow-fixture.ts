import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { installedCliProbes } from "../src/host-link-activation.js";
import type { HostFollowCycleDependencies } from "../src/host-follow-cycle.js";
import { readActiveCli } from "../src/host-follow-runtime.js";
import type { RepositoryUpgradeInvocation } from "../src/host-repository-upgrade-runner.js";
import { applyReleaseUpgrade, type HostUpgradeDependencies } from "../src/host-upgrade.js";
import { hostUpgradeLayout, type HostUpgradeLayout } from "../src/host-upgrade-layout.js";
import {
  extractingInstaller,
  fakeReleaseSource,
  releaseFixture,
  type ReleaseFixture,
} from "./host-release-fixture.js";

export const directories: string[] = [];

export async function cleanDirectories(): Promise<void> {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
}

export async function temporaryHome(): Promise<string> {
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-host-follow-")));
  directories.push(home);
  return home;
}

export const upgradeResult = (
  status: string,
  fields: Partial<Extract<RepositoryUpgradeInvocation, { kind: "result" }>> = {},
): RepositoryUpgradeInvocation => ({
  kind: "result",
  status,
  planId: null,
  applicableStages: [],
  appliedStages: [],
  pendingStages: [],
  timing: null,
  ...fields,
});

/** Decides one `lervo upgrade` answer from its arguments and the version the link runs now. */
export type RepositoryBehavior = (
  args: readonly string[],
  activeVersion: string | null,
) => RepositoryUpgradeInvocation;

export const allCurrent: RepositoryBehavior = () => upgradeResult("current");

export const release = (version: string, binSource?: string): ReleaseFixture =>
  releaseFixture({
    version,
    commit: version.replaceAll(".", "").padStart(40, "c").slice(0, 40),
    ...(binSource === undefined ? {} : { binSource }),
  });

export interface FollowHarness {
  home: string;
  layout: HostUpgradeLayout;
  upgrade: HostUpgradeDependencies;
  releases: ReleaseFixture[];
  source: ReturnType<typeof fakeReleaseSource> & { listings: number; failListing: boolean };
  running: { root: string | null };
  calls: { args: string[]; version: string | null }[];
  behavior: { current: RepositoryBehavior };
  dependencies: HostFollowCycleDependencies;
  /** Makes the process look like it runs the CLI the link names now. */
  runActive(): Promise<void>;
}

/** A host in a temporary home with v9.9.9 installed through ADR-0571 and two repositories. */
export async function followHarness(): Promise<FollowHarness> {
  const home = await temporaryHome();
  const layout = hostUpgradeLayout({ homeDirectory: home, platform: "linux" });
  let counter = 0;
  const upgrade: HostUpgradeDependencies = {
    layout,
    installer: extractingInstaller,
    probes: installedCliProbes,
    now: () => new Date("2026-11-17T00:00:00.000Z"),
    newActivationId: () => `hact_${String((counter += 1)).padStart(24, "0")}`,
    readCliPointer: async () => null,
  };
  const releases = [release("9.9.9")];
  const fake = fakeReleaseSource(releases);
  const source = Object.assign(fake, {
    listings: 0,
    failListing: false,
    async listReleases() {
      source.listings += 1;
      if (source.failListing)
        throw Object.assign(new Error("gh failed"), { code: "host_release_unavailable" });
      return releases.map((entry) => ({ tag: entry.tag, draft: false, prerelease: false }));
    },
  });
  await applyReleaseUpgrade(source, "v9.9.9", upgrade);
  const running = { root: (await readActiveCli(layout)).packageRoot };
  const calls: FollowHarness["calls"] = [];
  const behavior = { current: allCurrent };
  return {
    home,
    layout,
    upgrade,
    releases,
    source,
    running,
    calls,
    behavior,
    dependencies: {
      upgrade,
      source,
      listRepositories: async () => ["/repositories/one", "/repositories/two"],
      runRepositoryUpgrade: async (args) => {
        const version = (await readActiveCli(layout)).version;
        calls.push({ args: [...args], version });
        return behavior.current(args, version);
      },
      runningInstallRoot: async () => running.root,
    },
    async runActive() {
      running.root = (await readActiveCli(layout)).packageRoot;
    },
  };
}
