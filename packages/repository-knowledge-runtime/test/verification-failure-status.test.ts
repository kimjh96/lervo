import { expect, it } from "vitest";

import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import { verificationFailureFromEvidence } from "../src/verification-failure-status.js";

function store() {
  const bytes = new Map<string, Uint8Array>();
  return {
    put(value: unknown): string {
      const content = new TextEncoder().encode(canonicalJson(value));
      const hash = sha256(content);
      bytes.set(`lervo-cas://sha256/${hash.slice(7)}`, content);
      return hash;
    },
    artifacts: {
      get: async (uri: string) => {
        const value = bytes.get(uri);
        if (value === undefined) throw new Error("missing");
        return value;
      },
    } as never,
  };
}

const result = {
  schemaVersion: 1,
  suiteId: "repository.default.v9",
  status: "failed",
  commands: [
    {
      commandId: "repository-isolated-workspace-prepare",
      status: "passed",
      exitCode: 0,
      durationMs: 11020,
    },
    {
      commandId: "repository-lint",
      status: "timed_out",
      exitCode: null,
      durationMs: 300356,
      failureCode: "timeout",
    },
    { commandId: "repository-docs", status: "not_run", exitCode: null, durationMs: null },
  ],
};

it("names the first failed command of the suite a stop depends on (ADR-0562)", async () => {
  const cas = store();
  const resultHash = cas.put(result);
  const expected = {
    suiteId: "repository.default.v9",
    commandId: "repository-lint",
    status: "timed_out",
    exitCode: null,
    durationMs: 300356,
  };
  expect(await verificationFailureFromEvidence(cas.artifacts, resultHash)).toEqual(expected);
  // An assignment failure proof names the result one level further.
  const proof = cas.put({ kind: "convergence_assignment_failure", evidenceHash: resultHash });
  expect(await verificationFailureFromEvidence(cas.artifacts, proof)).toEqual(expected);
  // The owner's stage failure names the assignment proof, which names the result: two hops.
  const stage = cas.put({ kind: "stage_failure", evidenceHash: proof });
  expect(await verificationFailureFromEvidence(cas.artifacts, stage)).toEqual(expected);
  // A third hop is past the bound.
  const deeper = cas.put({ kind: "wrapper", evidenceHash: stage });
  expect(await verificationFailureFromEvidence(cas.artifacts, deeper)).toBeNull();
  // A passing suite, another kind of evidence, or a missing artifact names nothing.
  const passed = cas.put({ ...result, commands: [result.commands[0]] });
  expect(await verificationFailureFromEvidence(cas.artifacts, passed)).toBeNull();
  expect(
    await verificationFailureFromEvidence(
      cas.artifacts,
      cas.put({ kind: "private_stage_failure" }),
    ),
  ).toBeNull();
  expect(
    await verificationFailureFromEvidence(cas.artifacts, `sha256:${"0".repeat(64)}`),
  ).toBeNull();
  expect(await verificationFailureFromEvidence(cas.artifacts, null)).toBeNull();
});
