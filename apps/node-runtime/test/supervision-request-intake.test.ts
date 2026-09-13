import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";

import { admitSupervisionRequest } from "../src/supervision-request-intake.js";
import { readBoundSupervisionRequest } from "../src/supervision-bound-request.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

it("binds a local request to one installed owner and replays its exact source without a new event", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const request = {
    source: "local" as const,
    sourceId: "request-1",
    requesterId: "local_process_owner",
    request: "Complete the current bounded goal.",
    contentHash: hash("Complete the current bounded goal."),
  };
  const first = await admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request,
  });
  expect(first.duplicate).toBe(false);
  const replay = await admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request,
  });
  expect(replay).toEqual({ ...first, duplicate: true });
  const storage = await openProjectStorage(f.root);
  try {
    const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
    expect(
      source.supervisionEvents.filter((event) => event.type === "work.supervision.bound"),
    ).toHaveLength(1);
    expect(await readBoundSupervisionRequest(storage, source, f.binding)).toMatchObject({
      eventId: first.eventId,
      request: request.request,
      origin: null,
    });
    const owner = await canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now);
    expect(owner.facts.boundRequest?.request).toBe(request.request);
    expect(source.assignments).toHaveLength(0);
  } finally {
    await storage.close();
  }
  await expect(
    admitSupervisionRequest({
      repositoryRoot: f.root,
      binding: f.binding,
      request: {
        ...request,
        request: "A conflicting goal.",
        contentHash: hash("A conflicting goal."),
      },
    }),
  ).rejects.toThrow(/conflicts/iu);
  await expect(
    admitSupervisionRequest({
      repositoryRoot: f.root,
      binding: f.binding,
      request: { ...request, sourceId: "request-2" },
    }),
  ).rejects.toThrow(/already has a supervised request origin/iu);
  await expect(
    admitSupervisionRequest({
      repositoryRoot: f.root,
      binding: f.binding,
      request: { ...request, sourceId: "request-3", contentHash: hash("Different bytes") },
    }),
  ).rejects.toThrow(/source or content is invalid/iu);
});

it("retains the exact Discord result origin within the same canonical request contract", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const origin = {
    sourceEventId: `cve_${"3".repeat(64)}`,
    policyId: `cpp_${"4".repeat(64)}`,
    target: {
      integrationId: "itg_supervisiontest",
      projectId: f.owner.projectId,
      conversationId: "cnv_supervisiontest",
      threadId: null,
    },
    actor: {
      kind: "agent" as const,
      participantId: "ptc_supervisionowner",
      roleId: f.owner.roleId,
    },
  };
  const admitted = await admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request: {
      source: "discord",
      sourceId: origin.sourceEventId,
      requesterId: "ptc_requester:manager",
      request: "Complete the current bounded goal.",
      contentHash: hash("Complete the current bounded goal."),
      origin,
    },
  });
  const storage = await openProjectStorage(f.root);
  try {
    const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
    expect(await readBoundSupervisionRequest(storage, source, f.binding)).toMatchObject({
      eventId: admitted.eventId,
      source: "discord",
      origin,
    });
  } finally {
    await storage.close();
  }
});
