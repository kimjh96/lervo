import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as project from "../src/index.js";
import { readEventWriterCoordinateFile } from "../src/event-writer-coordinate-reader.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-coordinate-reader-"));
  roots.push(root);
  return { root, path: resolve(root, "coordinate.json") };
}

it("keeps the schema-validated continuation private and preserves arbitrary-object failures", () => {
  expect("readValidatedEventWriterCoordinate" in project).toBe(false);
  const failure = new Error("caller getter failed");
  const value = new Proxy(
    {},
    {
      get() {
        throw failure;
      },
    },
  );
  expect(() => project.readEventWriterCoordinate(value)).toThrow(failure);
});

it("preserves missing-file defaults and wrong-project domain refusal", async () => {
  const { path } = await fixture();
  expect(await readEventWriterCoordinateFile(path, "prj_coordinate")).toEqual({
    coordinate: project.defaultEventWriterCoordinate("prj_coordinate"),
    contentHash: null,
    source: "implicit_default",
  });
  await writeFile(path, JSON.stringify(project.defaultEventWriterCoordinate("prj_another01")));
  await expect(readEventWriterCoordinateFile(path, "prj_coordinate")).rejects.toMatchObject({
    code: "event_writer_coordinate_invalid",
    message: "The event writer coordinate belongs to another project.",
  });
});

it("keeps syntax errors separate from schema failures", async () => {
  const { path } = await fixture();
  await writeFile(path, "{");
  await expect(readEventWriterCoordinateFile(path, "prj_coordinate")).rejects.toMatchObject({
    code: "event_writer_coordinate_invalid",
    message: "The event writer coordinate is not valid JSON.",
    cause: expect.any(SyntaxError),
  });
  await writeFile(path, "null");
  await expect(readEventWriterCoordinateFile(path, "prj_coordinate")).rejects.toMatchObject({
    code: "event_writer_coordinate_invalid",
    message: "The event writer coordinate does not satisfy its versioned contract.",
  });
});

it("retains bounded regular-file guards before parsing", async () => {
  const { root, path } = await fixture();
  for (const bytes of [Buffer.from([255]), Buffer.alloc(65537, 32)]) {
    await writeFile(path, bytes);
    await expect(readEventWriterCoordinateFile(path, "prj_coordinate")).rejects.toMatchObject({
      code: "event_writer_coordinate_invalid",
      message: "The event writer coordinate must be a bounded regular file.",
    });
  }
  const target = resolve(root, "target.json");
  await writeFile(target, JSON.stringify(project.defaultEventWriterCoordinate("prj_coordinate")));
  await rm(path);
  await symlink(target, path);
  await expect(readEventWriterCoordinateFile(path, "prj_coordinate")).rejects.toMatchObject({
    code: "event_writer_coordinate_invalid",
    message: "The event writer coordinate must be a bounded regular file.",
  });
});
