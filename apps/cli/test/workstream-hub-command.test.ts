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

async function fixture() {
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
  const peer = { ...local, title: "Hub continuation" };
  const hash = (value: WorkstreamSnapshot) => sha256(`${canonicalJson(value)}\n`);
  const head = (snapshot: WorkstreamSnapshot) => ({
    workstreamId: snapshot.workstreamId,
    revision: snapshot.revision,
    status: snapshot.status,
    snapshotContentHash: hash(snapshot),
    previousSnapshotContentHash: null,
    publishedAt: snapshot.updatedAt,
  });
  let snapshots: WorkstreamSnapshot[] = [peer];
  const authenticated = (body: unknown) => ({
    authentication: {
      status: "verified",
      destinationId: "hub:test",
      peerIdentityHash: `sha256:${"a".repeat(64)}`,
    },
    body,
  });
  vi.spyOn(AuthenticatedHubHttpTransport.prototype, "readWorkstream").mockImplementation(async () =>
    authenticated({
      schemaVersion: 1,
      status: snapshots.length === 1 ? "current" : "divergent",
      projectId: project.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(project),
      heads: snapshots.map(head),
      snapshot: snapshots.length === 1 ? snapshots[0] : null,
    }),
  );
  const publish = vi
    .spyOn(AuthenticatedHubHttpTransport.prototype, "publishWorkstream")
    .mockImplementation(async (request: WorkstreamReplicationPublishRequest) => {
      if (request.snapshot.origin.reconciliationPredecessors !== undefined)
        snapshots = [request.snapshot];
      else if (!snapshots.some((snapshot) => hash(snapshot) === request.snapshotContentHash))
        snapshots.push(request.snapshot);
      return authenticated({
        schemaVersion: 1,
        status: snapshots.length === 1 ? "fast_forwarded" : "divergent",
        projectId: project.projectId,
        repositoryIdentityHash: calculateProjectIdentityHash(project),
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
    publish,
    advanceHub: () => {
      snapshots = [{ ...peer, revision: 2 }];
    },
    args: ["--hub-config", config, "--json"],
  };
}

it("plans without publication, applies both-parent reconciliation, and makes later sync idempotent", async () => {
  const f = await fixture();
  const bytes = await readFile(f.selectedPath, "utf8");
  expect(
    await runCli(["workstream", "reconcile", "--keep", "local", ...f.args], f.io),
    f.errors.join("\n"),
  ).toBe(0);
  const plan = JSON.parse(f.output.join(""));
  expect(plan.parents).toHaveLength(2);
  expect(f.publish).not.toHaveBeenCalled();
  expect(await readFile(f.selectedPath, "utf8")).toBe(bytes);
  f.output.length = 0;
  expect(
    await runCli(
      ["workstream", "reconcile", "--keep", "local", ...f.args, "--apply", plan.planId, "--write"],
      f.io,
    ),
  ).toBe(0);
  const current = JSON.parse(await readFile(f.selectedPath, "utf8"));
  expect(current).toMatchObject({
    revision: 1,
    title: f.local.title,
    origin: { reconciliationPredecessors: plan.parents },
  });
  expect(current.workstreamId).not.toBe(f.local.workstreamId);
  f.publish.mockClear();
  f.output.length = 0;
  expect(await runCli(["workstream", "sync", ...f.args], f.io), f.errors.join("\n")).toBe(0);
  expect(f.publish).not.toHaveBeenCalled();
  expect(JSON.parse(f.output.join(""))).toMatchObject({ status: "current", imported: false });
});

it("refuses stale review coordinates without changing either side", async () => {
  const f = await fixture();
  expect(
    await runCli(["workstream", "reconcile", "--keep", "local", ...f.args], f.io),
    f.errors.join("\n"),
  ).toBe(0);
  const plan = JSON.parse(f.output.join(""));
  f.advanceHub();
  expect(
    await runCli(
      ["workstream", "reconcile", "--keep", "local", ...f.args, "--apply", plan.planId, "--write"],
      f.io,
    ),
  ).toBe(1);
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.errors.join("")).toContain("stale");
  expect(JSON.parse(await readFile(f.selectedPath, "utf8"))).toMatchObject(f.local);
});

it("keeps the exact Hub continuation only when explicitly selected", async () => {
  const f = await fixture();
  expect(
    await runCli(["workstream", "reconcile", "--keep", "hub", ...f.args], f.io),
    f.errors.join("\n"),
  ).toBe(0);
  const plan = JSON.parse(f.output.join(""));
  expect(
    await runCli(
      ["workstream", "reconcile", "--keep", "hub", ...f.args, "--apply", plan.planId, "--write"],
      f.io,
    ),
  ).toBe(0);
  expect(JSON.parse(await readFile(f.selectedPath, "utf8"))).toMatchObject({ title: f.peer.title });
});
