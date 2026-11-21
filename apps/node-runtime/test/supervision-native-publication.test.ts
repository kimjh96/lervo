import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { FileSystemCas } from "@lervo/cas";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resultWritingContract } from "../src/conversation-result-publication.js";
import type { NativeOwnerPlanInput } from "../src/supervision-native-plans.js";
import { nativeResultPublication } from "../src/supervision-native-publication.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const text = "The saved value was updated and verified.";
const checks = resultWritingContract.verification.semanticChecks
  .filter((check) => check.required)
  .map((check) => ({ checkId: check.checkId, status: "passed", violationCount: 0 }));

async function publication(details: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "lervo-native-publication-"));
  roots.push(root);
  const artifacts = await FileSystemCas.open(root);
  const resultArtifactHash = (await artifacts.put(text)).contentHash;
  const input = {
    storage: { artifacts },
    facts: {
      acceptedGoal: {
        completionPlanHash: hash("d"),
        completionEventId: `evt_${"c".repeat(32)}`,
        resultArtifactHash,
        text,
      },
      resultWritingContract,
      boundRequest: null,
    },
    publicationOrigin: {
      sourceEventId: `cve_${"3".repeat(64)}`,
      policyId: `cpp_${"4".repeat(64)}`,
      target: {
        integrationId: "itg_nativepublication",
        projectId: `prj_${"7".repeat(16)}`,
        conversationId: "cnv_nativepublication",
        threadId: null,
      },
      actor: { kind: "agent", participantId: "ptc_nativeowner", roleId: "developer" },
    },
    base: {
      workstreamId: `wks_${"8".repeat(24)}`,
      ownerAgentId: `agt_${"a".repeat(24)}`,
    } as unknown as OperatingActionPlanV1,
    reasoningPlanHash: hash("e"),
    resultArtifactHash: hash("f"),
    now: () => "2026-11-20T00:00:00.000Z",
  } as unknown as NativeOwnerPlanInput;
  const output = await nativeResultPublication(input, details, hash("1"));
  return { output, resultArtifactHash };
}

it("binds the accepted result hash to a publication decision that carries none", async () => {
  const { output, resultArtifactHash } = await publication({
    writingPolicyId: resultWritingContract.writingPolicyId,
    checks,
  });
  expect(output.effect.resultArtifactHash).toBe(resultArtifactHash);
  expect(output.fields.effectContract).toBe("work.result_delivery.v2");
});

it("refuses a publication decision that returns a result hash", async () => {
  await expect(
    publication({
      resultContentHash: hash("2"),
      writingPolicyId: resultWritingContract.writingPolicyId,
      checks,
    }),
  ).rejects.toThrow(/differs from the accepted result/u);
});
