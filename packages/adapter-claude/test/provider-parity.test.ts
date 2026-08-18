import { createHash } from "node:crypto";

import {
  CodexAdapter,
  type CodexAppServerClient,
  type CodexThreadStartOptions,
} from "@roven/adapter-codex";
import type {
  AdapterContextEnvelope,
  AdapterStartRequest,
} from "@roven/schemas";
import { describe, expect, it } from "vitest";

import {
  ClaudeAdapter,
  type ClaudeAgentClient,
} from "../src/index.js";

function sha(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class ParityCodexClient implements CodexAppServerClient {
  injected: unknown;
  async startThread(_options: CodexThreadStartOptions) {
    return { threadId: "codex-parity-session" };
  }
  async injectItems(_threadId: string, items: readonly unknown[]) {
    this.injected = structuredClone(items);
  }
  async startTurn() {
    return { turnId: "codex-turn" };
  }
  async interruptTurn() {}
  async unsubscribe() {}
  async *notifications(_signal: AbortSignal): AsyncIterable<unknown> {}
  async close() {}
}

class ParityClaudeClient implements ClaudeAgentClient {
  injected: string | undefined;
  async appendContext(content: string) {
    this.injected = content;
  }
  async startTurn() {}
  async interrupt() {}
  async *messages(_signal: AbortSignal): AsyncIterable<unknown> {}
  async close() {}
}

function request(adapterId: string): AdapterStartRequest {
  return {
    kind: "start_request",
    schemaVersion: 1,
    adapterId,
    projectId: "prj_parity001",
    runId: "run_parity001",
    sessionId: "ses_parity001",
    roleId: "developer",
    writingPolicyId: "writing_ko-kr-human",
    requestDigest: sha("same task"),
    executionMode: "read_only",
    requestedAt: "2026-08-18T00:00:00Z",
  };
}

function envelope(adapterId: string): AdapterContextEnvelope {
  const agents = "모든 역할은 자기 session에 같은 공통 맥락을 주입받습니다.\n";
  const writing = "사람이 이해하는 자연스러운 한국어 문단으로 씁니다.\n";
  return {
    kind: "context_envelope",
    schemaVersion: 1,
    envelopeId: `envelope-${adapterId}`,
    adapterId,
    projectId: "prj_parity001",
    runId: "run_parity001",
    sessionId: "ses_parity001",
    roleId: "developer",
    writingPolicyId: "writing_ko-kr-human",
    writingPolicyDocumentId: "doc_writing_policy",
    targetTurnId: "turn-parity-1",
    contextGeneration: 0,
    documents: [
      {
        documentId: "doc_agents0001",
        path: "AGENTS.md",
        contentHash: sha(agents),
        byteCount: Buffer.byteLength(agents),
        scope: { kind: "full" },
        delivery: { kind: "inline", content: agents },
      },
      {
        documentId: "doc_writing_policy",
        path: ".roven/writing.ko-KR.md",
        contentHash: sha(writing),
        byteCount: Buffer.byteLength(writing),
        scope: { kind: "full" },
        delivery: { kind: "inline", content: writing },
      },
    ],
    createdAt: "2026-08-18T00:00:01Z",
  };
}

describe("managed provider parity", () => {
  it("preserves the same role, writing contract and document hashes in Codex and Claude", async () => {
    const codexClient = new ParityCodexClient();
    const claudeClient = new ParityClaudeClient();
    const now = () => new Date("2026-08-18T00:00:01Z");
    const codex = new CodexAdapter({
      repositoryRoot: "/repo",
      clientFactory: async () => codexClient,
      now,
      createReceiptId: () => "ctx_paritycodex",
    });
    const claude = new ClaudeAdapter({
      repositoryRoot: "/repo",
      clientFactory: async () => claudeClient,
      now,
      createProviderSessionId: () => "11111111-1111-4111-8111-111111111111",
      createReceiptId: () => "ctx_parityclaud",
    });

    const codexSession = await codex.start(request("roven/codex"));
    const claudeSession = await claude.start(request("roven/claude"));
    const codexEnvelope = envelope("roven/codex");
    const claudeEnvelope = envelope("roven/claude");
    const codexReceipt = await codex.injectContext(codexSession, codexEnvelope);
    const claudeReceipt = await claude.injectContext(claudeSession, claudeEnvelope);

    const evidence = (receipt: typeof codexReceipt) => ({
      roleId: receipt.roleId,
      writingPolicyId: receipt.writingPolicyId,
      writingPolicyDocumentId: receipt.writingPolicyDocumentId,
      controlledInput: receipt.controlledInput,
      documents: receipt.documents,
    });
    expect(evidence(claudeReceipt)).toEqual(evidence(codexReceipt));
    for (const document of codexEnvelope.documents) {
      const content = document.delivery.kind === "inline" ? document.delivery.content.trim() : "";
      expect(JSON.stringify(codexClient.injected)).toContain(content);
      expect(claudeClient.injected).toContain(content);
    }
  });
});
