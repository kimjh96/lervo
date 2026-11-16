import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import type { HostCliInstaller } from "../src/host-cli-install.js";
import { readNpmTarballEntries } from "../src/host-release-tarball.js";
import type { HostReleaseSource } from "../src/host-release-source.js";

const sha256 = (contents: Buffer) =>
  `sha256:${createHash("sha256").update(contents).digest("hex")}`;

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

/** A minimal ustar archive of regular files (or the given entry type), as npm packers write it. */
export function ustarArchive(entries: ([string, Buffer] | [string, Buffer, string])[]): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, contents, type = "0"] of entries) {
    const header = Buffer.alloc(512);
    header.write(path, 0, 100, "utf8");
    header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(contents.length, 12), 124);
    header.write(octal(0, 12), 136);
    header.fill(0x20, 148, 156);
    header.write(type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

export interface ReleaseFixture {
  tag: string;
  version: string;
  commit: string;
  tree: string;
  /** Asset name to bytes, binding included. */
  assets: Map<string, Buffer>;
  committed: Map<string, Buffer>;
  packageFiles: [string, Buffer][];
}

export interface ReleaseFixtureOptions {
  version?: string;
  commit?: string;
  tree?: string;
  dependencies?: Record<string, string>;
  /** The manifest's portable closure, as `name@version`. */
  portable?: string[];
  binSource?: string;
  nodeRuntimeSource?: string;
}

export function releaseFixture(options: ReleaseFixtureOptions = {}): ReleaseFixture {
  const version = options.version ?? "9.9.9";
  const commit = options.commit ?? "c".repeat(40);
  const tree = options.tree ?? "e".repeat(40);
  const committedPackage = {
    name: "@lervo/cli",
    version,
    type: "module",
    bin: { lervo: "./dist/bin.js", "lervo-node": "./dist/node-runtime.js" },
    dependencies: options.dependencies ?? {},
    devDependencies: { "@lervo/core": "workspace:*" },
  };
  const packedPackage = { ...committedPackage, devDependencies: { "@lervo/core": "0.1.0" } };
  const bin = Buffer.from(
    `#!/usr/bin/env node\n${
      options.binSource ??
      `if (process.argv.includes("--version")) console.log("lervo ${version}");\n`
    }`,
  );
  const packageFiles: [string, Buffer][] = [
    ["dist/bin.js", bin],
    ["dist/node-runtime.js", Buffer.from(options.nodeRuntimeSource ?? "export {};\n")],
  ];
  const tarball = ustarArchive([
    ["package/package.json", Buffer.from(`${JSON.stringify(packedPackage, null, 2)}\n`)],
    ...packageFiles.map(([path, contents]): [string, Buffer] => [`package/${path}`, contents]),
  ]);
  const manifest = Buffer.from(
    `${JSON.stringify({
      artifact: { name: "@lervo/cli", version },
      dependencies: {
        portable: options.portable ?? [],
        portableDigest: `sha256:${"0".repeat(64)}`,
        platformSpecificFamilies: [],
      },
      archive: {
        rootFiles: ["package.json"],
        files: packageFiles.map(([path, contents]) => ({
          path,
          size: contents.length,
          sha256: sha256(contents),
        })),
      },
    })}\n`,
  );
  const sbom = Buffer.from(`{"bomFormat":"CycloneDX","version":"${version}"}\n`);
  const subjects = new Map<string, Buffer>([
    [`lervo-cli-${version}.tgz`, tarball],
    ["release-artifact-manifest.json", manifest],
    ["release-sbom.cdx.json", sbom],
  ]);
  const binding = {
    schemaVersion: 1,
    artifact: "@lervo/cli",
    version,
    tag: `v${version}`,
    revision: "a".repeat(40),
    tree,
    files: [...subjects.keys()].sort().map((name) => {
      const contents = subjects.get(name) as Buffer;
      return { name, size: contents.length, sha256: sha256(contents) };
    }),
  };
  return {
    tag: `v${version}`,
    version,
    commit,
    tree,
    assets: new Map([
      ...subjects,
      ["release-subjects.json", Buffer.from(`${JSON.stringify(binding, null, 2)}\n`)],
    ]),
    committed: new Map([
      ["apps/cli/release-artifact-manifest.json", manifest],
      ["apps/cli/release-sbom.cdx.json", sbom],
      ["apps/cli/package.json", Buffer.from(`${JSON.stringify(committedPackage, null, 2)}\n`)],
    ]),
    packageFiles,
  };
}

/** An in-memory release source holding any number of releases. */
export function fakeReleaseSource(
  releases: ReleaseFixture[],
  overrides: { draft?: boolean; prerelease?: boolean } = {},
): HostReleaseSource & { downloads: number } {
  const find = (tag: string) => {
    const release = releases.find((candidate) => candidate.tag === tag);
    if (release === undefined)
      throw Object.assign(new Error("missing"), { code: "host_release_unavailable" });
    return release;
  };
  const source = {
    repository: "owner/lervo",
    downloads: 0,
    async readRelease(tag: string) {
      const release = find(tag);
      return {
        tag,
        draft: overrides.draft ?? false,
        prerelease: overrides.prerelease ?? false,
        assetNames: [...release.assets.keys()],
      };
    },
    async resolveTag(tag: string) {
      const release = find(tag);
      return { sha: release.commit, tree: release.tree };
    },
    async readCommittedFile(commit: string, path: string) {
      const release = releases.find((candidate) => candidate.commit === commit);
      const contents = release?.committed.get(path);
      if (contents === undefined) throw new Error(`missing ${path}`);
      return contents;
    },
    async downloadAssets(tag: string, directory: string) {
      source.downloads += 1;
      for (const [name, contents] of find(tag).assets)
        await writeFile(resolve(directory, name), contents);
    },
  };
  return source;
}

/**
 * Installs like pnpm does: the package lands in a virtual store, node_modules/@lervo/cli is a
 * relative link to it, and its bin files become executable. It extracts the tarball named by the
 * written package.json; `storeEntries` adds further virtual-store packages.
 */
export function extractingInstallerWith(storeEntries: string[] = []): HostCliInstaller {
  return async ({ directory, logPath }) => {
    const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const tarballPath = (manifest.dependencies["@lervo/cli"] as string).slice("file:".length);
    const entries = readNpmTarballEntries(await readFile(tarballPath));
    const storeName = "@lervo+cli@file+lervo-cli.tgz";
    const store = resolve(
      directory,
      "node_modules",
      ".pnpm",
      storeName,
      "node_modules",
      "@lervo",
      "cli",
    );
    for (const [path, contents] of entries) {
      await mkdir(dirname(resolve(store, path)), { recursive: true });
      await writeFile(resolve(store, path), contents);
    }
    const packageManifest = JSON.parse(
      (entries.get("package.json") as Buffer).toString("utf8"),
    ) as {
      bin: Record<string, string>;
    };
    for (const target of Object.values(packageManifest.bin))
      await chmod(resolve(store, target), 0o755);
    for (const entry of storeEntries)
      await mkdir(resolve(directory, "node_modules", ".pnpm", entry), { recursive: true });
    await mkdir(resolve(directory, "node_modules", "@lervo"), { recursive: true });
    await symlink(
      `../.pnpm/${storeName}/node_modules/@lervo/cli`,
      resolve(directory, "node_modules", "@lervo", "cli"),
    );
    await writeFile(logPath, "installed\n");
  };
}

export const extractingInstaller = extractingInstallerWith();

/**
 * A loopback npm registry serving fixed package versions, so a real pnpm install can resolve a
 * registry dependency without the network. `latest` is the newest version, which an unpinned
 * caret range would pick.
 */
export async function startFixtureRegistry(
  name: string,
  versions: string[],
): Promise<{ url: string; close: () => Promise<void> }> {
  const tarballs = new Map(
    versions.map((version) => [
      version,
      ustarArchive([
        ["package/package.json", Buffer.from(JSON.stringify({ name, version }))],
        ["package/index.js", Buffer.from(`module.exports = "${version}";\n`)],
      ]),
    ]),
  );
  let base = "";
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "").split("?")[0] ?? "");
    if (path === `/${name}`) {
      const packument = {
        name,
        "dist-tags": { latest: versions.at(-1) },
        time: Object.fromEntries(versions.map((version) => [version, "2020-01-01T00:00:00.000Z"])),
        versions: Object.fromEntries(
          [...tarballs].map(([version, tarball]) => [
            version,
            {
              name,
              version,
              dist: {
                tarball: `${base}/${name}/-/${name}-${version}.tgz`,
                shasum: createHash("sha1").update(tarball).digest("hex"),
                integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
              },
            },
          ]),
        ),
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(packument));
      return;
    }
    const version = /-(\d+\.\d+\.\d+)\.tgz$/u.exec(path)?.[1];
    const tarball = version === undefined ? undefined : tarballs.get(version);
    if (tarball === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(tarball);
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: `${base}/`,
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  };
}
