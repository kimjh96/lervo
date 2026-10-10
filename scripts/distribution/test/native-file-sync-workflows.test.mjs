import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { expect, it } from "vitest";
const read = async (name) =>
  parse(await readFile(resolve(import.meta.dirname, "../../../.github/workflows", name), "utf8"));
it("shares one source-bound macOS artifact with the full CI build", async () => {
  const workflow = await read("code-quality.yml");
  const producer = workflow.jobs["native-runtime"],
    consumer = workflow.jobs["release-artifacts"];
  expect(producer["runs-on"]).toBe("macos-latest");
  expect(producer.needs).toBe("quality");
  expect(producer.if).toBe("needs.quality.outputs.coverage == 'full'");
  expect(consumer.needs).toContain("native-runtime");
  expect(
    producer.steps.some(
      (step) =>
        step.run?.includes("packages/filesystem-durability/scripts/build-native.mjs") &&
        step.run?.includes("packages/cas/scripts/build-native.mjs"),
    ),
  ).toBe(true);
  const upload = producer.steps.find((step) => step.name === "Share exact native artifact");
  expect(upload.with.name).toBe("native-runtime");
  expect(upload.with["retention-days"]).toBe(3);
  const restore = consumer.steps.findIndex((step) =>
    step.run?.includes("native-runtime-transfer.mjs restore"),
  );
  expect(restore).toBeGreaterThan(0);
  expect(restore).toBeLessThan(consumer.steps.findIndex((step) => step.run === "pnpm build"));
});
it("uses the same native transfer for all packed platforms and attestation", async () => {
  const workflow = await read("cli-release-matrix.yml");
  expect(workflow.jobs["packed-cli"].strategy.matrix.os).toEqual([
    "ubuntu-latest",
    "macos-latest",
    "windows-latest",
  ]);
  for (const name of ["packed-cli", "attested-cli"]) {
    const job = workflow.jobs[name];
    expect([job.needs].flat()).toContain("native-runtime");
    const restore = job.steps.findIndex((step) =>
      step.run?.includes("native-runtime-transfer.mjs restore"),
    );
    expect(restore).toBeGreaterThan(0);
    expect(restore).toBeLessThan(job.steps.findIndex((step) => step.run === "pnpm build"));
  }
  expect(workflow.jobs["native-runtime"].if).toBe(workflow.jobs["packed-cli"].if);
  expect((await read("release-preparation.yml")).jobs.reconcile["runs-on"]).toBe("macos-latest");
});
