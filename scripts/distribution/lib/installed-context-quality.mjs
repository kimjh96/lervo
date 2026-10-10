import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
const execute = promisify(execFile);

/** Qualify the installed public CLI and an explicitly activated isolated writer. */
export async function verifyInstalledContextQuality(consumerRoot) {
  const cli = resolve(consumerRoot, "node_modules/@lervo/cli/dist/bin.js");
  const root = resolve(consumerRoot, "installed-context-quality");
  await mkdir(root);
  const run = async (args, expectedCode = 0) => {
    try {
      const result = await execute(process.execPath, [cli, ...args], {
        cwd: root,
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
      });
      assert.equal(expectedCode, 0);
      return JSON.parse(result.stdout);
    } catch (error) {
      assert.equal(error.code, expectedCode, error.stderr);
      return JSON.parse(error.stdout);
    }
  };
  await run(["init", "--minimal", "--name", "installed-context-quality", "--json"]);
  const text = "# Result\nThe test passed.\n\n> Preserve this quotation.\n";
  await writeFile(resolve(root, "README.md"), text);
  await writeFile(resolve(root, "baseline.md"), text);
  const evidence = await run(["event-contract", "evidence", "--json"]);
  assert.ok(
    evidence.readers.every((reader) => reader.capabilities.readableEventSchemaVersions.includes(6)),
  );
  const evidencePath = resolve(root, "reader-evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence));
  const activation = await run([
    "event-contract",
    "activate",
    "--schema-version",
    "6",
    "--from",
    evidencePath,
    "--json",
  ]);
  await run([
    "event-contract",
    "activate",
    "--schema-version",
    "6",
    "--from",
    evidencePath,
    "--apply",
    activation.planId,
    "--json",
  ]);
  const prepared = await run([
    "knowledge",
    "query",
    "inspect installed outcome",
    "--record",
    "--json",
  ]);
  assert.equal(prepared.recording.status, "recorded");
  assert.ok(prepared.quality.plan.planDigest.startsWith("sha256:"));
  const verified = await run(
    [
      "knowledge",
      "query",
      "inspect installed outcome",
      "--verify-artifact",
      "README.md",
      "--expected-plan",
      prepared.quality.plan.planDigest,
      "--baseline",
      "baseline.md",
      "--record",
      "--json",
    ],
    2,
  );
  assert.equal(verified.verification.disposition, "unavailable");
  assert.equal(verified.verificationRecording.status, "recorded");
  const rollback = await run(["event-contract", "rollback", "--json"]);
  await run(["event-contract", "rollback", "--apply", rollback.planId, "--json"]);
  const after = await run([
    "knowledge",
    "query",
    "inspect installed outcome",
    "--record",
    "--json",
  ]);
  assert.equal(after.recording.status, "writer_not_active");
  return {
    status: "passed",
    preparedEventId: prepared.recording.eventId,
    verifiedEventId: verified.verificationRecording.eventId,
  };
}
