import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import { loadProjectManifest } from "@lervo/project";
import type { WorkstreamReplicationPublishRequest, WorkstreamSnapshot } from "@lervo/schemas";
import { AuthenticatedHubHttpTransport } from "@lervo/sync";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { runCli } from "../src/main.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(peerAge: "older" | "newer" = "older") {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workstream-hub-"));
  roots.push(root);
  const output: string[] = [];
  const errors: string[] = [];
  const io = {
    cwd: root,
    stdout: (text: string) => output.push(text),
    stderr: (text: string) => errors.push(text),
  };
  expect(await runCli(["init"], io)).toBe(0);
  const manifestPath = resolve(root, ".lervo/project.yaml");
  const configured = parse(await readFile(manifestPath, "utf8"));
  configured.dataPolicy.hubSyncEnabled = true;
  await writeFile(manifestPath, stringify(configured));
  const draft = {
    schemaVersion: 1,
    status: "active",
    title: "Local continuation",
    objective: "Keep verified local work.",
    nextActions: [],
    blockers: [],
    notes: [],
    references: [],
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
  expect(
    await runCli(["workstream", "start", "--stdin", "--apply-now"], {
      ...io,
      stdin: async () => JSON.stringify(draft),
    }),
  ).toBe(0);
  const selectedPath = resolve(root, ".lervo/state/workstreams/current.json");
  const local = JSON.parse(await readFile(selectedPath, "utf8")) as WorkstreamSnapshot;
  const project = await loadProjectManifest(root);
  const tokenPath = resolve(root, "token");
  await writeFile(tokenPath, "private-test-token-that-is-long-enough", { mode: 0o600 });
  const config = resolve(root, "hub.json");
  await writeFile(
    config,
    JSON.stringify({
      hub: {
        baseUrl: "https://hub.example/",
        bearerTokenFile: tokenPath,
        destinationId: "hub:test",
        hubIdentityHash: `sha256:${"a".repeat(64)}`,
      },
    }),
    { mode: 0o600 },
  );
  const peer = {
    ...local,
    title: "Hub continuation",
    updatedAt: new Date(
      Date.parse(local.updatedAt) + (peerAge === "newer" ? 1 : -1) * 3_600_000,
    ).toISOString(),
  };
  const hash = (value: WorkstreamSnapshot) => sha256(`${canonicalJson(value)}\n`);
  const previous = new Map<string, string | null>([[hash(peer), null]]);
  const head = (snapshot: WorkstreamSnapshot) => ({
    workstreamId: snapshot.workstreamId,
    revision: snapshot.revision,
    status: snapshot.status,
    snapshotContentHash: hash(snapshot),
    previousSnapshotContentHash: previous.get(hash(snapshot)) ?? null,
    publishedAt: snapshot.updatedAt,
  });
  // Every published revision stays readable by its exact hash, as on the Hub.
  const stored = new Map<string, WorkstreamSnapshot>([[hash(peer), peer]]);
  let snapshots: WorkstreamSnapshot[] = [peer];
  const authenticated = (body: unknown) => ({
    authentication: {
      status: "verified",
      destinationId: "hub:test",
      peerIdentityHash: `sha256:${"a".repeat(64)}`,
    },
    body,
  });
  const coordinates = {
    projectId: project.projectId,
    repositoryIdentityHash: calculateProjectIdentityHash(project),
  };
  vi.spyOn(AuthenticatedHubHttpTransport.prototype, "readWorkstream").mockImplementation(async () =>
    authenticated({
      schemaVersion: 1,
      status: snapshots.length === 1 ? "current" : "divergent",
      ...coordinates,
      heads: snapshots.map(head),
      snapshot: snapshots.length === 1 ? snapshots[0] : null,
    }),
  );
  vi.spyOn(AuthenticatedHubHttpTransport.prototype, "readWorkstreamRevision").mockImplementation(
    async (snapshotContentHash: string) => {
      const snapshot = stored.get(snapshotContentHash);
      if (snapshot === undefined) throw new Error("not found");
      return authenticated({
        schemaVersion: 1,
        ...coordinates,
        revision: head(snapshot),
        isHead: snapshots.some((candidate) => hash(candidate) === snapshotContentHash),
        snapshot,
      });
    },
  );
  const publish = vi
    .spyOn(AuthenticatedHubHttpTransport.prototype, "publishWorkstream")
    .mockImplementation(async (request: WorkstreamReplicationPublishRequest) => {
      stored.set(request.snapshotContentHash, request.snapshot);
      previous.set(request.snapshotContentHash, request.previousSnapshotContentHash);
      if (request.snapshot.origin.reconciliationPredecessors !== undefined)
        snapshots = [request.snapshot];
      else if (snapshots.some((snapshot) => hash(snapshot) === request.previousSnapshotContentHash))
        snapshots = snapshots.map((snapshot) =>
          hash(snapshot) === request.previousSnapshotContentHash ? request.snapshot : snapshot,
        );
      else if (!snapshots.some((snapshot) => hash(snapshot) === request.snapshotContentHash))
        snapshots.push(request.snapshot);
      return authenticated({
        schemaVersion: 1,
        status: snapshots.length === 1 ? "fast_forwarded" : "divergent",
        ...coordinates,
        heads: snapshots.map(head),
      });
    });
  output.length = 0;
  return {
    root,
    io,
    output,
    errors,
    selectedPath,
    config,
    local,
    peer,
    peerHash: hash(peer),
    publish,
    args: ["--hub-config", config, "--json"],
  };
}

it("keeps the newest local head without the owner, preserves the Hub head, and later syncs idempotently", async () => {
  const f = await fixture();
  expect(await runCli(["workstream", "reconcile", ...f.args], f.io), f.errors.join("\n")).toBe(0);
  const result = JSON.parse(f.output.join(""));
  expect(result).toMatchObject({
    status: "reconciled",
    kept: "local",
    preserved: { snapshotContentHash: f.peerHash },
    notice: {
      effect: "workstream_reconciled",
      undo: `lervo workstream reconcile --restore ${f.peerHash}`,
    },
  });
  expect(result.parents).toHaveLength(2);
  const current = JSON.parse(await readFile(f.selectedPath, "utf8"));
  expect(current).toMatchObject({
    revision: 1,
    title: f.local.title,
    origin: { reconciliationPredecessors: result.parents },
  });
  expect(current.workstreamId).not.toBe(f.local.workstreamId);
  f.publish.mockClear();
  f.output.length = 0;
  expect(await runCli(["workstream", "sync", ...f.args], f.io), f.errors.join("\n")).toBe(0);
  expect(f.publish).not.toHaveBeenCalled();
  expect(JSON.parse(f.output.join(""))).toMatchObject({ status: "current", imported: false });
});

it("keeps a newer Hub head and restores the preserved local head on request", async () => {
  const f = await fixture("newer");
  expect(await runCli(["workstream", "reconcile", ...f.args], f.io), f.errors.join("\n")).toBe(0);
  const result = JSON.parse(f.output.join(""));
  expect(result).toMatchObject({ status: "reconciled", kept: "hub" });
  expect(JSON.parse(await readFile(f.selectedPath, "utf8"))).toMatchObject({ title: f.peer.title });
  f.output.length = 0;
  expect(
    await runCli(
      ["workstream", "reconcile", "--restore", result.preserved.snapshotContentHash, ...f.args],
      f.io,
    ),
    f.errors.join("\n"),
  ).toBe(0);
  expect(JSON.parse(f.output.join(""))).toMatchObject({
    status: "restored",
    revision: 2,
    notice: { effect: "workstream_head_restored" },
  });
  expect(JSON.parse(await readFile(f.selectedPath, "utf8"))).toMatchObject({
    workstreamId: result.workstreamId,
    revision: 2,
    title: f.local.title,
  });
});

it("reports a current workstream when nothing diverged", async () => {
  const f = await fixture();
  expect(await runCli(["workstream", "reconcile", ...f.args], f.io)).toBe(0);
  f.output.length = 0;
  f.publish.mockClear();
  expect(await runCli(["workstream", "reconcile", ...f.args], f.io), f.errors.join("\n")).toBe(0);
  expect(JSON.parse(f.output.join(""))).toMatchObject({ status: "current" });
  expect(f.publish).not.toHaveBeenCalled();
});

it("rejects the removed owner choice with the restore path", async () => {
  const f = await fixture();
  const bytes = await readFile(f.selectedPath, "utf8");
  expect(await runCli(["workstream", "reconcile", "--keep", "local", ...f.args], f.io)).toBe(1);
  expect(f.errors.join("")).toContain("lervo workstream reconcile --restore <snapshot-hash>");
  expect(f.publish).not.toHaveBeenCalled();
  expect(await readFile(f.selectedPath, "utf8")).toBe(bytes);
});
