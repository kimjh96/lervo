import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { CommandFailure } from "./command-error-output.js";
import { closureOverrides, compareInstalledClosure } from "./host-cli-dependencies.js";
import type { HostReleaseSource } from "./host-release-source.js";
import { RELEASE_SUBJECTS_BINDING, type VerifiedRelease } from "./host-release-verification.js";
import { releaseDirectoryName, type HostUpgradeLayout } from "./host-upgrade-layout.js";

/** Installs the package.json written into `directory`; rejects when the install fails. */
export type HostCliInstaller = (input: { directory: string; logPath: string }) => Promise<void>;

export interface DownloadedReleaseSubjects {
  directory: string;
  bindingContents: Buffer;
  files: Map<string, Buffer>;
}

const maximumDownloadedFiles = 8;
const installMarker = "lervo-host-install.json";
const installTimeoutMilliseconds = 10 * 60_000;

async function readDownloadedFiles(directory: string): Promise<DownloadedReleaseSubjects> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > maximumDownloadedFiles || entries.some((entry) => !entry.isFile()))
    throw new CommandFailure(
      "release_subjects_file_set_mismatch",
      "The release subject file set is not exact.",
    );
  const files = new Map<string, Buffer>();
  for (const entry of entries)
    files.set(entry.name, await readFile(resolve(directory, entry.name)));
  const bindingContents = files.get(RELEASE_SUBJECTS_BINDING) ?? Buffer.alloc(0);
  files.delete(RELEASE_SUBJECTS_BINDING);
  return { directory, bindingContents, files };
}

/** Downloads every asset of the release into a fresh staging directory, not yet trusted. */
export async function downloadReleaseSubjects(
  layout: HostUpgradeLayout,
  source: HostReleaseSource,
  tag: string,
): Promise<DownloadedReleaseSubjects> {
  await mkdir(layout.downloadsDirectory, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(resolve(layout.downloadsDirectory, ".staging-"));
  try {
    await source.downloadAssets(tag, staging);
    return await readDownloadedFiles(staging);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function sameFiles(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([readDownloadedFiles(left), readDownloadedFiles(right)]);
  if (!a.bindingContents.equals(b.bindingContents) || a.files.size !== b.files.size) return false;
  return [...a.files].every(([name, contents]) => b.files.get(name)?.equals(contents) === true);
}

/**
 * Keeps verified subjects under their release directory. A directory that already exists must
 * hold the same bytes; a different download for the same tag and commit fails closed.
 */
export async function promoteReleaseSubjects(
  layout: HostUpgradeLayout,
  staging: string,
  release: VerifiedRelease,
): Promise<string> {
  const target = resolve(
    layout.downloadsDirectory,
    releaseDirectoryName(release.tag, release.commit),
  );
  try {
    if ((await lstat(target).catch(() => null)) === null) {
      await rename(staging, target);
      return target;
    }
    if (!(await sameFiles(staging, target)))
      throw new CommandFailure(
        "host_upgrade_download_conflict",
        `A different download of ${release.tag} is already kept at ${target}.`,
        { directory: target },
      );
    return target;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  const metadata = await lstat(path).catch(() => null);
  return metadata?.isFile() === true;
}

/** The physical root of the `@lervo/cli` package inside one install directory. */
export async function installedPackageRoot(installDirectory: string): Promise<string | null> {
  const root = await realpath(resolve(installDirectory, "node_modules", "@lervo", "cli")).catch(
    () => null,
  );
  return root !== null && (await isRegularFile(resolve(root, "dist", "bin.js"))) ? root : null;
}

async function readInstallMarker(directory: string): Promise<{ tarballSha256?: unknown } | null> {
  try {
    return JSON.parse(await readFile(resolve(directory, installMarker), "utf8")) as {
      tarballSha256?: unknown;
    };
  } catch {
    return null;
  }
}

/** The install directory one verified release uses, whether or not it exists yet. */
export function releaseInstallDirectory(
  layout: HostUpgradeLayout,
  release: Pick<VerifiedRelease, "version" | "commit">,
): string {
  return resolve(layout.installsDirectory, releaseDirectoryName(release.version, release.commit));
}

/**
 * Installs the verified tarball side by side with its declared runtime dependencies and returns
 * the installed package root. An existing install of the same tarball digest is reused; one of
 * another digest fails closed instead of being replaced under a running process.
 */
export async function installReleasePackage(input: {
  layout: HostUpgradeLayout;
  release: VerifiedRelease;
  tarballPath: string;
  installer: HostCliInstaller;
}): Promise<{ installDirectory: string; packageRoot: string; reused: boolean }> {
  const installDirectory = releaseInstallDirectory(input.layout, input.release);
  if ((await lstat(installDirectory).catch(() => null)) !== null) {
    const marker = await readInstallMarker(installDirectory);
    const root = await installedPackageRoot(installDirectory);
    if (marker?.tarballSha256 !== input.release.tarballSha256 || root === null)
      throw new CommandFailure(
        "host_upgrade_install_conflict",
        `${installDirectory} already exists and is not an install of the verified ${input.release.tag} tarball.`,
        { installDirectory },
      );
    return { installDirectory, packageRoot: root, reused: true };
  }
  await mkdir(input.layout.installsDirectory, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(resolve(input.layout.installsDirectory, ".staging-"));
  try {
    const manifest = {
      name: "lervo-host-cli",
      version: "0.0.0",
      private: true,
      dependencies: { ...input.release.dependencies, "@lervo/cli": `file:${input.tarballPath}` },
    };
    await writeFile(resolve(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    // JSON is valid YAML; pnpm reads overrides from the workspace file.
    await writeFile(
      resolve(staging, "pnpm-workspace.yaml"),
      `${JSON.stringify({ overrides: closureOverrides(input.release.dependencyClosure) }, null, 2)}\n`,
    );
    const logPath = resolve(staging, "install.log");
    try {
      await input.installer({ directory: staging, logPath });
    } catch {
      // One bounded file keeps the newest failure's installer output after staging is removed.
      const failureLog = resolve(input.layout.installsDirectory, "last-install-failure.log");
      await rename(logPath, failureLog).catch(() => undefined);
      throw new CommandFailure(
        "host_upgrade_install_failed",
        `Installing ${input.release.tag} failed; nothing was activated. The installer output is in ${failureLog}.`,
        { log: failureLog },
      );
    }
    const stagedRoot = await installedPackageRoot(staging);
    const installedVersion =
      stagedRoot === null
        ? null
        : (
            JSON.parse(await readFile(resolve(stagedRoot, "package.json"), "utf8")) as {
              version?: unknown;
            }
          ).version;
    if (installedVersion !== input.release.version)
      throw new CommandFailure(
        "host_upgrade_install_failed",
        `The install of ${input.release.tag} does not hold @lervo/cli ${input.release.version}; nothing was activated.`,
      );
    await requireInstalledClosure(staging, input.release);
    await writeFile(
      resolve(staging, installMarker),
      `${JSON.stringify({ tag: input.release.tag, commit: input.release.commit, tree: input.release.tree, tarballSha256: input.release.tarballSha256 }, null, 2)}\n`,
    );
    await rename(staging, installDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const root = await installedPackageRoot(installDirectory);
  if (root === null)
    throw new CommandFailure(
      "host_upgrade_install_failed",
      `The install of ${input.release.tag} has no regular dist/bin.js after it moved into place.`,
    );
  return { installDirectory, packageRoot: root, reused: false };
}

const maximumReportedPackages = 20;

async function requireInstalledClosure(directory: string, release: VerifiedRelease): Promise<void> {
  const entries = await readdir(resolve(directory, "node_modules", ".pnpm")).catch(() => []);
  const difference = compareInstalledClosure(entries, release.dependencyClosure);
  if (difference.unexpected.length === 0 && difference.missing.length === 0) return;
  throw new CommandFailure(
    "host_upgrade_dependencies_mismatch",
    `The install of ${release.tag} resolved npm packages other than the release's verified closure (${difference.unexpected.length} unexpected, ${difference.missing.length} missing); nothing was activated.`,
    {
      unexpected: difference.unexpected.slice(0, maximumReportedPackages),
      missing: difference.missing.slice(0, maximumReportedPackages),
    },
  );
}

/** The production installer: pnpm, without lifecycle scripts, in the staging directory. */
export const pnpmInstaller: HostCliInstaller = async ({ directory, logPath }) => {
  // Inherited package-manager configuration, for example from `pnpm exec lervo`, would change how
  // the install resolves; the install runs with the user's own configuration only.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(npm|pnpm)_config_/iu.test(key) && key !== "npm_lifecycle_event",
    ),
  );
  const output = await new Promise<string>((resolvePromise, reject) => {
    execFile(
      "pnpm",
      ["install", "--ignore-scripts", "--prefer-offline", "--reporter=append-only"],
      { cwd: directory, env, timeout: installTimeoutMilliseconds, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const text = `${stdout}${stderr}`;
        if (error === null) resolvePromise(text);
        else
          writeFile(logPath, text).then(
            () => reject(error),
            () => reject(error),
          );
      },
    );
  });
  await writeFile(logPath, output);
};
