import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { artifactBuildHash } from "../lib/context-quality-artifact-identity.mjs";

it("binds native runtime bytes and their manifest along with JavaScript", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-artifact-identity-"));
  try {
    const native = resolve(root, "packages/storage/dist/native");
    await mkdir(native, { recursive: true });
    await mkdir(resolve(root, "apps"));
    await writeFile(resolve(native, "../index.js"), "export const version = 1;");
    const jsOnly = await artifactBuildHash(root);
    await writeFile(resolve(native, "file-sync-darwin.node"), "native-v1");
    const withNative = await artifactBuildHash(root);
    expect(withNative).not.toBe(jsOnly);
    await writeFile(resolve(native, "file-sync-darwin.node"), "native-v2");
    expect(await artifactBuildHash(root)).not.toBe(withNative);
    const beforeManifest = await artifactBuildHash(root);
    await writeFile(resolve(native, "file-sync.json"), '{"schemaVersion":1}');
    const withManifest = await artifactBuildHash(root);
    expect(withManifest).not.toBe(beforeManifest);
    await writeFile(resolve(native, "file-sync.json"), '{"schemaVersion":2}');
    const changedManifest = await artifactBuildHash(root);
    expect(changedManifest).not.toBe(withManifest);
    await writeFile(resolve(native, "../index.d.ts"), "export declare const version: 1;");
    expect(await artifactBuildHash(root)).toBe(changedManifest);
    await writeFile(resolve(native, "cas-io.json"), '{"schemaVersion":1}');
    const withCasManifest = await artifactBuildHash(root);
    expect(withCasManifest).not.toBe(changedManifest);
    await writeFile(resolve(native, "cas-io.json"), '{"schemaVersion":2}');
    expect(await artifactBuildHash(root)).not.toBe(withCasManifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
