import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256, type RepositoryLayoutMigrationPlan } from "@lervo/repository-knowledge";
import {
  inspectDocumentDeferralHealth,
  observeDocumentDeferrals,
} from "../src/document-deferral-health.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const layout = (paths: string[]) =>
  ({
    deferredDocumentCount: paths.length,
    deferredDocuments: paths.map((path) => ({ path })),
  }) as RepositoryLayoutMigrationPlan;
it("tracks first observation across scans and drops resolved debt", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-deferral-health-"));
  roots.push(root);
  expect(await inspectDocumentDeferralHealth({ repositoryRoot: root })).toBeNull();
  await observeDocumentDeferrals({
    repositoryRoot: root,
    layout: layout(["TRACE.md"]),
    now: new Date(0),
  });
  await observeDocumentDeferrals({
    repositoryRoot: root,
    layout: layout(["TRACE.md", "OTHER.md"]),
    now: new Date(2000),
  });
  expect(
    await inspectDocumentDeferralHealth({ repositoryRoot: root, now: new Date(5000) }),
  ).toMatchObject({ deferredDocumentCount: 2, oldestDeferralAgeMs: 5000 });
  await observeDocumentDeferrals({
    repositoryRoot: root,
    layout: layout(["OTHER.md"]),
    now: new Date(6000),
  });
  expect(
    await inspectDocumentDeferralHealth({ repositoryRoot: root, now: new Date(7000) }),
  ).toMatchObject({ deferredDocumentCount: 1, oldestDeferralAgeMs: 5000 });
  await observeDocumentDeferrals({ repositoryRoot: root, layout: layout([]), now: new Date(8000) });
  expect(await inspectDocumentDeferralHealth({ repositoryRoot: root })).toMatchObject({
    deferredDocumentCount: 0,
    oldestDeferralAgeMs: null,
  });
});

it("keeps age unknown after overflow even when all retained observations resolve", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-deferral-overflow-"));
  roots.push(root);
  const paths = Array.from({ length: 4097 }, (_, index) => `note-${index}.md`);
  await observeDocumentDeferrals({ repositoryRoot: root, layout: layout(paths), now: new Date(0) });
  expect(
    await inspectDocumentDeferralHealth({ repositoryRoot: root, now: new Date(1000) }),
  ).toMatchObject({
    deferredDocumentCount: 4097,
    oldestDeferralAgeMs: null,
    historyTruncated: true,
  });
  const state = JSON.parse(
    await readFile(resolve(root, ".lervo/state/knowledge/document-deferrals.json"), "utf8"),
  );
  const retained = new Set(state.documents.map((item: { pathHash: string }) => item.pathHash));
  const dropped = paths.find((path) => !retained.has(sha256(path)))!;
  await observeDocumentDeferrals({
    repositoryRoot: root,
    layout: layout([dropped]),
    now: new Date(2000),
  });
  expect(
    await inspectDocumentDeferralHealth({ repositoryRoot: root, now: new Date(3000) }),
  ).toMatchObject({ deferredDocumentCount: 1, oldestDeferralAgeMs: null, historyTruncated: true });
  await observeDocumentDeferrals({ repositoryRoot: root, layout: layout([]), now: new Date(4000) });
  await observeDocumentDeferrals({
    repositoryRoot: root,
    layout: layout(["new.md"]),
    now: new Date(5000),
  });
  expect(
    await inspectDocumentDeferralHealth({ repositoryRoot: root, now: new Date(6000) }),
  ).toMatchObject({ deferredDocumentCount: 1, oldestDeferralAgeMs: 1000, historyTruncated: false });
});
