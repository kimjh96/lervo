import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import type { ConversationTerminalFailureResponder } from "@lervo/interaction";
import { afterEach, describe, expect, it } from "vitest";

import { FixedConversationTerminalFailureResponder } from "../src/terminal-failure-responder.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("fixed conversation terminal failure response", () => {
  it("explains the safe failure category without internal coordinates", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-response-"));
    roots.push(root);
    const artifacts = await FileSystemCas.open(root);
    const responder = new FixedConversationTerminalFailureResponder({ artifactStore: artifacts });
    const result = await responder.respond({
      event: null,
      policy: null,
      decision: null,
      failureCode: "response_context_unavailable",
      attemptCount: 1,
    } as unknown as Parameters<ConversationTerminalFailureResponder["respond"]>[0]);
    const content = Buffer.from(
      await artifacts.get(result.publicationEvidence.artifact.uri),
    ).toString("utf8");

    expect(content).toBe(
      "저장소 맥락을 읽는 중 문제가 생겼습니다. 1회 시도 후 종료했으며, 새 메시지는 계속 처리됩니다.",
    );
    expect(result.audienceParticipation).toBe("observe_only");
    expect(content).not.toMatch(/(?:cve|run|wks|revision)_/u);
  });

  it("warns against duplicate execution when an effect cannot be confirmed", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-effect-response-"));
    roots.push(root);
    const artifacts = await FileSystemCas.open(root);
    const responder = new FixedConversationTerminalFailureResponder({ artifactStore: artifacts });
    const result = await responder.respond({
      event: null,
      policy: null,
      decision: null,
      failureCode: "response_effect_unconfirmed",
      attemptCount: 3,
    } as unknown as Parameters<ConversationTerminalFailureResponder["respond"]>[0]);
    const content = Buffer.from(
      await artifacts.get(result.publicationEvidence.artifact.uri),
    ).toString("utf8");

    expect(content).toContain("같은 요청을 다시 보내지 말고 현재 상태를 먼저 확인");
    expect(content).toContain("3회 시도 후 종료");
  });
});
