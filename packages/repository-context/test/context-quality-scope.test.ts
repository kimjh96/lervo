import { afterEach, expect, it, vi } from "vitest";
import { createQualityRecordingScopes } from "../src/context-quality-scope.js";
afterEach(() => {
  vi.useRealTimers();
});
it("releases only after both recording kinds are admitted", async () => {
  vi.useFakeTimers();
  const scopes = createQualityRecordingScopes();
  scopes.begin("/repo", "request");
  const prepared = scopes.admission("/repo", "request", "prepared")!;
  const verified = scopes.admission("/repo", "request", "verified")!;
  prepared.admit();
  prepared.admit();
  expect(prepared.isReady()).toBe(false);
  verified.admit();
  await prepared.ready;
  expect(prepared.isReady()).toBe(true);
  expect(scopes.admission("/repo", "request", "verified")).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
it("supports reverse arrival without conflating another root or request", async () => {
  vi.useFakeTimers();
  const scopes = createQualityRecordingScopes();
  const seals = [
    scopes.begin("/one", "request"),
    scopes.begin("/two", "request"),
    scopes.begin("/one", "other"),
  ];
  const admission = scopes.admission("/one", "request", "verified")!;
  admission.admit();
  scopes.admission("/two", "request", "prepared")!.admit();
  scopes.admission("/one", "other", "prepared")!.admit();
  expect(admission.isReady()).toBe(false);
  scopes.admission("/one", "request", "prepared")!.admit();
  expect(admission.isReady()).toBe(false);
  seals[2]?.();
  await admission.ready;
  for (const seal of seals) seal?.();
  expect(vi.getTimerCount()).toBe(0);
});
it("seals explicitly and expires after the finite referenced backstop", async () => {
  vi.useFakeTimers();
  const scopes = createQualityRecordingScopes();
  const seal = scopes.begin("/repo", "first")!;
  const first = scopes.admission("/repo", "first", "prepared")!;
  seal();
  seal();
  await first.ready;
  scopes.begin("/repo", "second");
  const second = scopes.admission("/repo", "second", "prepared")!;
  await vi.advanceTimersByTimeAsync(49);
  expect(second.isReady()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await second.ready;
  expect(second.isReady()).toBe(true);
  expect(scopes.admission("/repo", "second", "prepared")).toBeUndefined();
});
it("bounds roots and scopes, refuses duplicate ownership and releases capacity", () => {
  vi.useFakeTimers();
  const scopes = createQualityRecordingScopes();
  const seals = [];
  for (let root = 0; root < 8; root++)
    for (let request = 0; request < 16; request++)
      seals.push(scopes.begin(`/repo${root}`, String(request))!);
  expect(scopes.begin("/repo8", "0")).toBeUndefined();
  expect(scopes.begin("/repo0", "16")).toBeUndefined();
  expect(scopes.begin("/repo0", "0")).toBeUndefined();
  for (const seal of seals) seal();
  expect(vi.getTimerCount()).toBe(0);
  const replacement = scopes.begin("/repo8", "0");
  expect(replacement).toBeTypeOf("function");
  replacement?.();
});

it("freezes related membership at first admission and releases every member together", async () => {
  vi.useFakeTimers();
  const scopes = createQualityRecordingScopes();
  scopes.begin("/repo/child/..", "first");
  scopes.begin("/repo", "second");
  const first = scopes.admission("/repo", "first", "prepared")!;
  first.admit();
  const sealLate = scopes.begin("/repo", "late")!;
  const late = scopes.admission("/repo", "late", "prepared")!;
  scopes.admission("/repo", "first", "verified")!.admit();
  expect(first.isReady()).toBe(false);
  scopes.admission("/repo", "second", "verified")!.admit();
  scopes.admission("/repo", "second", "prepared")!.admit();
  await first.ready;
  expect(late.isReady()).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
  sealLate();
  await late.ready;
});
it("caps groups at eight observations and does not extend the first deadline", async () => {
  vi.useFakeTimers();
  const scopes = createQualityRecordingScopes();
  scopes.begin("/repo", "0");
  const first = scopes.admission("/repo", "0", "prepared")!;
  await vi.advanceTimersByTimeAsync(40);
  const seals = Array.from({ length: 8 }, (_, i) => scopes.begin("/repo", String(i + 1))!);
  const ninth = scopes.admission("/repo", "8", "prepared")!;
  expect(vi.getTimerCount()).toBe(2);
  await vi.advanceTimersByTimeAsync(10);
  await first.ready;
  expect(ninth.isReady()).toBe(false);
  // Stale owners cannot remove a replacement request after their group expired.
  const replacement = scopes.begin("/repo", "1")!;
  seals[0]!();
  expect(scopes.admission("/repo", "1", "prepared")).toBeDefined();
  replacement();
  seals[7]!();
  expect(vi.getTimerCount()).toBe(0);
});
