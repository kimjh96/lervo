import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { expect, it } from "vitest";
import { darwinToolchainPin } from "../lib/darwin-toolchain.mjs";
const read = async (name) =>
  parse(await readFile(resolve(import.meta.dirname, "../../../.github/workflows", name), "utf8"));
it("shares one source-bound macOS artifact with the full CI build", async () => {
  const workflow = await read("code-quality.yml");
  const producer = workflow.jobs["native-runtime"],
    consumer = workflow.jobs["release-artifacts"];
  expect(producer["runs-on"]).toBe(darwinToolchainPin.runner);
  expect(producer.needs).toEqual(["plan", "native-runtime-reuse"]);
  // macOS compiles only when no verified build of identical native inputs was restored (ADR-0590).
  expect(producer.if).toBe(
    "${{ !cancelled() && needs.plan.outputs.coverage == 'full' && needs.plan.outputs.reuseBuild == '' && needs.native-runtime-reuse.outputs.restored != 'true' }}",
  );
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
    darwinToolchainPin.runner,
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
  const preparation = await read("release-preparation.yml");
  // Pending intent builds darwin native files on macOS; a tag-only reconcile runs on Linux.
  // A route job that fails before deciding falls back to the pinned macOS image (ADR-0590).
  expect(preparation.jobs.reconcile["runs-on"]).toBe(
    `\${{ needs.route.outputs.runner || '${darwinToolchainPin.runner}' }}`,
  );
  expect(preparation.jobs.reconcile.needs).toBe("route");
  expect(preparation.jobs.reconcile.if).toBe(`!cancelled() && ${preparation.jobs.route.if}`);
  const intent = preparation.jobs.route.steps.find((step) => step.id === "intent").run;
  expect(intent).toContain("compgen -G '.changes/*.yaml'");
  const route = preparation.jobs.route.steps.at(-1).run;
  expect(route).toContain(`runner=${darwinToolchainPin.runner}`);
  expect(route).toContain("runner=ubuntu-latest");
});
it("builds every recorded darwin native file with the pinned image and Xcode", async () => {
  const codeQuality = await read("code-quality.yml");
  const matrix = await read("cli-release-matrix.yml");
  const pullRequest = await read("release-pull-request.yml");
  const preparation = await read("release-preparation.yml");
  const builders = [
    [codeQuality.jobs["native-runtime"], "build-native.mjs"],
    [matrix.jobs["native-runtime"], "build-native.mjs"],
    [pullRequest.jobs.prepare, "reconcile-release-workflow.mjs pull-request"],
    [preparation.jobs.reconcile, "reconcile-release-workflow.mjs candidate"],
  ];
  for (const [job, build] of builders) {
    expect(job.env.DEVELOPER_DIR).toBe(darwinToolchainPin.developerDir);
    const check = job.steps.findIndex((step) =>
      step.run?.endsWith("scripts/distribution/check-darwin-toolchain.mjs"),
    );
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(job.steps.findIndex((step) => step.run?.includes(build)));
  }
  for (const job of [codeQuality.jobs["native-runtime"], matrix.jobs["native-runtime"]])
    expect(job["runs-on"]).toBe(darwinToolchainPin.runner);
  expect(pullRequest.jobs.prepare["runs-on"]).toBe(darwinToolchainPin.runner);
  // A tag-only reconcile runs on Linux, where neither the variable nor the check applies.
  const preparationCheck = preparation.jobs.reconcile.steps.find((step) =>
    step.run?.endsWith("check-darwin-toolchain.mjs"),
  );
  expect(preparationCheck.if).toContain("runner.os == 'macOS'");
  // No job follows macos-latest, whose image and default Xcode change without a commit.
  const labels = [];
  const collect = (value) => {
    if (typeof value === "string") labels.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  for (const workflow of [codeQuality, matrix, pullRequest, preparation]) collect(workflow.jobs);
  expect(labels.filter((value) => value.includes("macos-latest"))).toEqual([]);
});
