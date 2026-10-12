import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import * as config from "../src/config.js";
import {
  applyInitPlan,
  createInitPlan,
  inspectProjectStorageCoordinates,
  inspectEventWriterCoordinate,
  inspectReportStorageCoordinate,
  planEventWriterActivation,
  applyEventWriterActivationPlan,
  planReportStorageActivation,
  applyReportStorageActivation,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(selected = true) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-coordinate-observation-"));
  roots.push(root);
  const projectId = "prj_joint_coordinates";
  await applyInitPlan(await createInitPlan({ root, projectId }));
  if (selected) {
    const eventEvidence = {
      schemaVersion: 1,
      projectId,
      observedAt: new Date().toISOString(),
      readers: [
        {
          readerId: "reader_jointfixture",
          readerKind: "local",
          peerIdentityHash: null,
          capabilities: createEventReaderCapabilities(),
        },
      ],
    };
    const writerPlan = await planEventWriterActivation({
      repositoryRoot: root,
      evidence: eventEvidence,
      targetEventSchemaVersion: 6,
    });
    await applyEventWriterActivationPlan({
      plan: writerPlan,
      approval: writerPlan.planId,
      currentEvidence: eventEvidence,
    });
    const writer = await inspectEventWriterCoordinate(root);
    const evidence = {
      schemaVersion: 1,
      projectId,
      observedAt: new Date().toISOString(),
      writerCoordinateHash: writer.contentHash,
      readers: [
        {
          readerId: "reader_jointfixture",
          peerIdentityHash: null,
          artifactHash: `sha256:${"a".repeat(64)}`,
          readableStorageFormats: [3, 4],
        },
      ],
      rollback: { artifactHash: `sha256:${"b".repeat(64)}`, readableStorageFormats: [3, 4] },
    };
    const plan = await planReportStorageActivation({ repositoryRoot: root, evidence });
    await applyReportStorageActivation({ plan, approval: plan.planId, currentEvidence: evidence });
  }
  return root;
}

it("binds both coordinates to one fresh manifest per observation without retaining caller values", async () => {
  const root = await fixture();
  const writer = await inspectEventWriterCoordinate(root),
    reports = await inspectReportStorageCoordinate(root);
  const loader = vi.spyOn(config, "loadProjectManifest");
  const first = await inspectProjectStorageCoordinates(root);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(first.writer).toEqual(writer);
  expect(first.reports).toEqual(reports);
  first.manifest.name = "caller mutation";
  first.writer.coordinate.selectedEventSchemaVersion = 1;
  const path = resolve(root, ".lervo/project.yaml");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(/^name:.*$/m, "name: current owner value"),
  );
  const next = await inspectProjectStorageCoordinates(root);
  expect(loader).toHaveBeenCalledTimes(2);
  expect(next.manifest.name).toBe("current owner value");
  expect(next.writer.coordinate.selectedEventSchemaVersion).toBe(6);
  await expect(access(resolve(root, ".lervo/data/events.sqlite"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("preserves implicit writer and absent report selection without creating storage", async () => {
  const root = await fixture(false);
  const observation = await inspectProjectStorageCoordinates(root);
  expect(observation.writer.source).toBe("implicit_default");
  expect(observation.writer.coordinate.selectedEventSchemaVersion).toBe(1);
  expect(observation.reports.coordinate).toBeNull();
  await expect(access(resolve(root, ".lervo/data"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("observes either pending activation fence and rejects current malformed or redirected files", async () => {
  const root = await fixture();
  for (const [file, code] of [
    [".event-contract-activation", "event_writer_recovery_required"],
    [".report-storage-pending", "report_storage_recovery_required"],
  ]) {
    const path = resolve(root, ".lervo/data", file!);
    await writeFile(path, "{}");
    await expect(inspectProjectStorageCoordinates(root)).rejects.toMatchObject({ code });
    await rm(path);
  }
  for (const [file, code] of [
    ["event-contract.json", "event_writer_coordinate_invalid"],
    ["report-storage.json", "report_storage_invalid"],
  ]) {
    const path = resolve(root, ".lervo/data", file!),
      original = await readFile(path);
    await writeFile(path, "{}");
    await expect(inspectProjectStorageCoordinates(root)).rejects.toMatchObject({ code });
    await writeFile(path, original);
    await rm(path);
    await symlink(resolve(root, "README.md"), path);
    await expect(inspectProjectStorageCoordinates(root)).rejects.toMatchObject({ code });
    await rm(path);
    await writeFile(path, original);
  }
});
it("rejects coordinates bound to a different freshly observed project", async () => {
  const root = await fixture();
  await inspectProjectStorageCoordinates(root);
  const path = resolve(root, ".lervo/project.yaml");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace("prj_joint_coordinates", "prj_other_coordinates"),
  );
  await expect(inspectProjectStorageCoordinates(root)).rejects.toMatchObject({
    code: "event_writer_coordinate_invalid",
  });
});
