import { coreLinkProtocolDocument } from "@lervo/session-host-contract";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { CommandFailure } from "../src/command-error-output.js";
import { type CoreLinkHandlers, CoreLinkServer } from "../src/core-link-server.js";
import { createHostedStreamDecoder } from "../src/hosted-session-adapters.js";
import type { WorkspaceStartResult } from "../src/workspace-start.js";

const document = coreLinkProtocolDocument();
const ajv = new Ajv2020({ strict: true });
ajv.addSchema(document);
const validResponse = ajv.getSchema(`${String(document.$id)}#/$defs/CoreLinkResponse`)!;

const started: WorkspaceStartResult = {
  schemaVersion: 1,
  status: "started",
  workspaceId: "wsp_0123456789abcdef01234567",
  workstreamId: "wks_0123456789abcdef01234567",
  projectId: "prj_0123456789abcdef",
  branch: "lervo/fix-the-build-1a2b3c",
  sessionId: "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c",
  provider: "claude",
  launch: {
    program: "/opt/claude",
    arguments: ["--print"],
    environment: {},
    workingDirectory: "/work/app-wt/fix-the-build-1a2b3c",
    mode: "native",
    initialInput: "Fix the build.",
  },
};

function handlers(release?: Promise<void>): CoreLinkHandlers {
  return {
    async startWorkspace(arguments_) {
      await release;
      if (arguments_.instruction === "fail")
        throw new CommandFailure("workspace_start_failed", "failed", { stage: "workstream" });
      return started;
    },
    async openWorkspace() {
      throw new CommandFailure("workspace_not_found", "missing");
    },
    listWorkspaces: async () => ({ workspaces: [] }),
    listRepositories: async () => ({ repositories: [{ projectId: "prj_1", name: "app" }] }),
    createDecoder: createHostedStreamDecoder,
  };
}

async function* input(lines: readonly unknown[]) {
  for (const line of lines) yield `${typeof line === "string" ? line : JSON.stringify(line)}\n`;
}

async function serve(lines: readonly unknown[], release?: Promise<void>) {
  const written: Record<string, unknown>[] = [];
  const end = await new CoreLinkServer(handlers(release), (line) =>
    written.push(JSON.parse(line) as Record<string, unknown>),
  ).serve(input(lines));
  for (const response of written)
    expect(validResponse(response), JSON.stringify(response)).toBe(true);
  return { end, written };
}

describe("the core-link server", () => {
  it("answers commands with the launch, and failures with their code and stage", async () => {
    const { end, written } = await serve([
      {
        kind: "core.command",
        id: 1,
        command: "workspace.start",
        arguments: { instruction: "go", repository: "prj_1" },
      },
      {
        kind: "core.command",
        id: 2,
        command: "workspace.start",
        arguments: { instruction: "fail", repository: "prj_1" },
      },
      { kind: "core.open", id: 3, workspaceId: "wsp_0123456789abcdef01234567" },
    ]);
    expect(end).toBe("input_closed");
    expect(written.find((response) => response.id === 1)).toMatchObject({
      kind: "core.result",
      result: { workspaceId: started.workspaceId, branch: started.branch },
      launch: {
        sessionId: started.sessionId,
        conversationMode: "native",
        provider: "claude",
        initialInput: "Fix the build.",
      },
    });
    expect(written.find((response) => response.id === 2)).toEqual({
      kind: "core.failed",
      id: 2,
      code: "workspace_start_failed",
      stage: "workstream",
    });
    expect(written.find((response) => response.id === 3)).toEqual({
      kind: "core.failed",
      id: 3,
      code: "workspace_not_found",
    });
  });

  it("answers list commands with their result and no launch", async () => {
    const { written } = await serve([
      { kind: "core.command", id: 1, command: "repository.list", arguments: {} },
      { kind: "core.command", id: 2, command: "workspace.list", arguments: {} },
    ]);
    expect(written).toEqual([
      {
        kind: "core.result",
        id: 1,
        result: { repositories: [{ projectId: "prj_1", name: "app" }] },
      },
      { kind: "core.result", id: 2, result: { workspaces: [] } },
    ]);
  });

  it("answers decoder requests while a command still runs", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const output = Buffer.from(
      `${JSON.stringify({ type: "result", subtype: "success", is_error: false })}\n`,
    ).toString("base64");
    const serving = serve(
      [
        {
          kind: "core.command",
          id: 1,
          command: "workspace.start",
          arguments: { instruction: "go", repository: "prj_1" },
        },
        { kind: "decoder.open", id: 2, decoderId: "dec_1", provider: "claude" },
        { kind: "decoder.send", id: 3, decoderId: "dec_1", text: "Hello" },
        { kind: "decoder.output", id: 4, decoderId: "dec_1", data: output },
        { kind: "decoder.close", id: 5, decoderId: "dec_1" },
        { kind: "decoder.output", id: 6, decoderId: "dec_1", data: output },
        { kind: "decoder.open", id: 7, decoderId: "dec_2", provider: "codex" },
      ],
      gate.finally(() => undefined),
    );
    setTimeout(release, 20);
    const { written } = await serving;
    expect(written.map((response) => response.id)).toEqual([2, 3, 4, 5, 6, 7, 1]);
    expect(written[1]).toMatchObject({
      events: [{ kind: "item" }, { kind: "status", event: "turn_started" }],
    });
    expect(
      JSON.parse(Buffer.from(String(written[1]?.input), "base64").toString("utf8")),
    ).toMatchObject({ type: "user" });
    expect(written[2]).toMatchObject({ events: [{ kind: "status", event: "turn_finished" }] });
    expect(written[4]).toMatchObject({ kind: "core.failed", code: "decoder_not_found" });
    expect(written[5]).toMatchObject({
      kind: "core.failed",
      code: "conversation_mode_unsupported",
    });
  });

  it("ends the link on a line that breaks the protocol", async () => {
    const { end, written } = await serve([
      { kind: "decoder.open", id: 1, decoderId: "dec_1", provider: "claude" },
      { kind: "core.command", id: 2, command: "workspace.delete", arguments: {} },
      { kind: "decoder.close", id: 3, decoderId: "dec_1" },
    ]);
    expect(end).toBe("message_invalid");
    expect(written.map((response) => response.id)).toEqual([1]);
    expect((await serve(["not json"])).end).toBe("message_invalid");
  });
});
