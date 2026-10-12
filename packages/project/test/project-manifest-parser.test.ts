import { mkdtemp, readFile, rm, utimes, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { applyInitPlan, createInitPlan, loadProjectManifest } from "../src/index.js";
import { createDefaultManifest } from "../src/config.js";
import { createProjectManifestParser } from "../src/project-manifest-parser.js";
import * as yaml from "../src/yaml-contract.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function fixture() {
  vi.useFakeTimers();
  const value = createDefaultManifest(
    { root: "/fixture", projectId: "prj_parserfixture" },
    "/fixture",
  );
  const content = yaml.serializeYaml(value);
  const parse = vi.spyOn(yaml, "parseAndValidateYaml");
  return { value, content, parse, decode: createProjectManifestParser() };
}

it("reuses exact bytes while isolating both first and subsequent callers", () => {
  const { value, content, parse, decode } = fixture();
  const first = decode(content);
  first.dataPolicy.hubSyncEnabled = !value.dataPolicy.hubSyncEnabled;
  const second = decode(content);
  expect(second).toEqual(value);
  second.name = "changed by caller";
  expect(decode(content)).toEqual(value);
  expect(parse).toHaveBeenCalledTimes(1);
});

it("expires idle entries and does not let repeated hits extend retention", () => {
  const { content, parse, decode } = fixture();
  decode(content);
  vi.advanceTimersByTime(900);
  decode(content);
  expect(parse).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(101);
  decode(content);
  expect(parse).toHaveBeenCalledTimes(2);
});

it("checks expiry even when the timer has not run", () => {
  const { content, parse, decode } = fixture();
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  decode(content);
  now.mockReturnValue(1001);
  decode(content);
  expect(parse).toHaveBeenCalledTimes(2);
});

it("evicts the oldest of eight entries and cancels its retirement timer", () => {
  const { content, parse, decode } = fixture();
  for (let i = 0; i < 9; i++) decode(`${content}# ${i}\n`);
  expect(vi.getTimerCount()).toBe(8);
  decode(`${content}# 8\n`);
  expect(parse).toHaveBeenCalledTimes(9);
  decode(`${content}# 0\n`);
  expect(parse).toHaveBeenCalledTimes(10);
  vi.advanceTimersByTime(1001);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the input-byte bound without lowering the accepted manifest size", () => {
  const { content, value, parse, decode } = fixture();
  const large = `${content}# ${"한".repeat(22000)}\n`;
  expect(large.length).toBeLessThan(65536);
  expect(Buffer.byteLength(large)).toBeGreaterThan(65536);
  expect(decode(large)).toEqual(value);
  expect(decode(large)).toEqual(value);
  expect(parse).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["broken: [", "schemaVersion: 999\n"])("never retains invalid input: %s", (content) => {
  const { parse, decode } = fixture();
  expect(() => decode(content)).toThrow();
  expect(() => decode(content)).toThrow();
  expect(parse).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("observes changed manifest bytes with restored size and mtime before returning authority", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-manifest-parser-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_parserfixture" }));
  expect((await loadProjectManifest(root)).projectId).toBe("prj_parserfixture");
  const path = resolve(root, ".lervo/project.yaml");
  const before = await stat(path);
  const content = await readFile(path, "utf8");
  await writeFile(path, content.replace("prj_parserfixture", "prj_changefixture"));
  // Both IDs deliberately have the same byte length.
  expect((await stat(path)).size).toBe(before.size);
  await utimes(path, before.atime, before.mtime);
  expect((await loadProjectManifest(root)).projectId).toBe("prj_changefixture");
});
