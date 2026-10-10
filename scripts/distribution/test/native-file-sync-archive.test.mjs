import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { nativeFileSyncFixture } from "./native-file-sync-fixture.mjs";
import { canonicalJson, sha256 } from "../../shared/release-artifact-manifest.mjs";
import { readNativeFileSyncArtifact } from "../../shared/native-file-sync-artifact.mjs";
import { collectDistributionEntries } from "../lib/node-runtime-distribution.mjs";
import * as hub from "../lib/hub-runtime-distribution.mjs";
import * as node from "../lib/node-runtime-distribution.mjs";
const run = promisify(execFile);

it.each(["hub", "node"])(
  "verifies %s archive native identity, legacy reads and missing/changed assets",
  async (kind) => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-native-archive-"));
    const payload = resolve(root, "payload"),
      archive = resolve(root, "runtime.tar.gz");
    const owner = kind === "hub" ? hub : node;
    const prefix = kind === "hub" ? "Hub" : "Node";
    const manifestName = kind === "hub" ? hub.hubManifestName : node.manifestName;
    const dependencies = ["@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.226"];
    const platform = { os: "darwin", arch: "arm64", libc: "none" };
    const fixture = nativeFileSyncFixture();
    let native;
    async function put(path, bytes) {
      await mkdir(resolve(payload, path, ".."), { recursive: true });
      await writeFile(resolve(payload, path), bytes);
    }
    async function packageFixture({
      legacy = false,
      corruptNative = false,
      omitNativeSbom = false,
    } = {}) {
      const sbom =
        kind === "hub"
          ? hub.createHubDistributionSbom(
              "0.1.0",
              sha256("fixture"),
              omitNativeSbom ? undefined : native,
            )
          : node.createNodeDistributionSbom(
              "0.1.0",
              dependencies,
              sha256("fixture"),
              omitNativeSbom ? undefined : native,
            );
      await put("sbom.cdx.json", canonicalJson(sbom));
      if (corruptNative) await put("dist/native/file-sync-darwin.node", Buffer.from("modified"));
      const files = await collectDistributionEntries(payload, new Set([manifestName]));
      const manifest = owner[`create${prefix}DistributionManifest`]({
        runtimeVersion: "0.1.0",
        platform,
        files,
        dependencies,
        sbomSha256: sha256(canonicalJson(sbom)),
      });
      if (legacy) manifest.schemaVersion = 1;
      const bytes = canonicalJson(manifest);
      await put(manifestName, bytes);
      await run("tar", ["-czf", archive, "-C", payload, "."], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });
      const archiveBytes = await readFile(archive);
      const descriptor = owner[`create${prefix}DistributionArtifact`]({
        runtimeVersion: "0.1.0",
        platform,
        archiveFileName: "runtime.tar.gz",
        byteCount: archiveBytes.length,
        sha256: sha256(archiveBytes),
        manifestSha256: sha256(bytes),
      });
      const artifact = resolve(root, "artifact.json");
      await writeFile(artifact, canonicalJson(descriptor));
      return {
        archive,
        artifact,
        expectedSha256: descriptor.sha256,
        smoke: false,
        requireCurrentPlatform: false,
      };
    }
    const verify = owner[`verify${prefix}DistributionArchive`];
    try {
      await put("dist/bin.js", "fixture");
      await chmod(resolve(payload, "dist/bin.js"), 0o755);
      await put("package.json", "{}");
      await put("README.md", "fixture");
      if (kind === "hub") for (const path of hub.requiredHubAssetPaths) await put(path, "fixture");
      else {
        await put(
          "node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json",
          JSON.stringify({
            name: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
            version: "0.3.226",
          }),
        );
        await mkdir(resolve(payload, "node_modules/.pnpm"));
      }
      await put("dist/native/file-sync-darwin.node", fixture.binary);
      await put("dist/native/file-sync.json", JSON.stringify(fixture.manifest));
      native = await readNativeFileSyncArtifact(resolve(payload, "dist/native"), {
        required: true,
      });
      const good = await verify(await packageFixture());
      expect(good.manifest.schemaVersion).toBe(2);
      expect(
        await readFile(resolve(good.payloadRoot, "dist/native/file-sync-darwin.node")),
      ).toEqual(fixture.binary);
      await rm(good.temporaryRoot, { recursive: true, force: true });
      await expect(verify(await packageFixture({ omitNativeSbom: true }))).rejects.toThrow(
        "sbom_invalid",
      );
      await expect(verify(await packageFixture({ corruptNative: true }))).rejects.toThrow(
        "identity_invalid",
      );
      await rm(resolve(payload, "dist/native"), { recursive: true });
      native = undefined;
      await expect(verify(await packageFixture())).rejects.toThrow();
      const legacy = await verify(await packageFixture({ legacy: true }));
      expect(legacy.manifest.schemaVersion).toBe(1);
      await rm(legacy.temporaryRoot, { recursive: true, force: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
