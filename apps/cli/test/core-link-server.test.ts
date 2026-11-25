import {
  advertisedCoreRequestNames,
  applicationCommandNames,
  applicationResultSchemas,
  coreLinkProtocolDocument,
} from "@lervo/session-host-contract";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { CommandFailure } from "../src/command-error-output.js";
import {
  type CoreLinkHandlers,
  CoreLinkServer,
  MAX_PENDING_TURN_USAGE,
} from "../src/core-link-server.js";
import { createHostedStreamDecoder, listHostedProviders } from "../src/hosted-session-adapters.js";
import type { WorkspaceStartResult } from "../src/workspace-start.js";

const document = coreLinkProtocolDocument();
const ajv = new Ajv2020({ strict: true });
ajv.addSchema(document);
const validResponse = ajv.getSchema(`${String(document.$id)}#/$defs/CoreLinkResponse`)!;
const validResult = (command: keyof typeof applicationResultSchemas) =>
  ajv.getSchema(`${String(document.$id)}#/$defs/${applicationResultSchemas[command].title}`)!;

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
    environmentRemove: ["CLAUDECODE"],
    settingsFile: { path: "/state/hosted-settings/session.json", content: "{}\n" },
  },
  hostedEvents: "recorded",
};

/** Each `recordTurnUsage` call: the session and the models it carried. */
const recordedUsage: [string, (string | null)[]][] = [];

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
    listProviders: () => listHostedProviders({ PATH: "" }),
    createDecoder: createHostedStreamDecoder,
    async readTranscript(workspaceId, offset) {
      if (workspaceId !== started.workspaceId)
        throw new CommandFailure("workspace_not_found", "missing");
      return {
        items: [
          { content: { kind: "user_message", text: "Fix the build." }, createdAtMs: 1000 + offset },
        ],
        complete: true,
      };
    },
    async retireWorkspace(workspaceId) {
      if (workspaceId !== started.workspaceId)
        throw new CommandFailure("workspace_has_changes", "changed");
      return { workspaceId, worktree: "removed", branch: "deleted" };
    },
    recordSessionExit: async (sessionId, exitCode) => ({
      status: sessionId === started.sessionId && exitCode === null ? "recorded" : "unknown_session",
    }),
    async recordTurnUsage(sessionId, _accounting, usage) {
      recordedUsage.push([sessionId, usage.map((turn) => turn.model)]);
      return { status: "recorded", recorded: usage.length, duplicates: 0, dropped: 0 };
    },
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
        environmentRemove: ["CLAUDECODE"],
      },
    });
    // The core writes the settings file itself; the session host never receives it.
    expect(JSON.stringify(written)).not.toContain("hosted-settings");
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

  it("answers workspace.retire with the result and passes on its failure", async () => {
    const { written } = await serve([
      {
        kind: "core.command",
        id: 1,
        command: "workspace.retire",
        arguments: { workspaceId: started.workspaceId },
      },
      {
        kind: "core.command",
        id: 2,
        command: "workspace.retire",
        arguments: { workspaceId: "wsp_other" },
      },
      {
        kind: "core.command",
        id: 3,
        command: "workspace.retire",
        arguments: { workspaceId: "../x" },
      },
    ]);
    const result = written.find((response) => response.id === 1);
    expect(result).toEqual({
      kind: "core.result",
      id: 1,
      result: { workspaceId: started.workspaceId, worktree: "removed", branch: "deleted" },
    });
    const valid = validResult("workspace.retire");
    expect(valid(result?.result), JSON.stringify(valid.errors)).toBe(true);
    expect(written.find((response) => response.id === 2)).toMatchObject({
      kind: "core.failed",
      code: "workspace_has_changes",
    });
    expect(written.find((response) => response.id === 3)).toMatchObject({
      kind: "core.failed",
      code: "workspace_not_found",
    });
  });

  it("answers list commands with their result and no launch", async () => {
    const { written } = await serve([
      { kind: "core.command", id: 1, command: "repository.list", arguments: {} },
      { kind: "core.command", id: 2, command: "workspace.list", arguments: {} },
      { kind: "core.command", id: 3, command: "provider.list", arguments: {} },
    ]);
    expect(written.slice(0, 2)).toEqual([
      {
        kind: "core.result",
        id: 1,
        result: { repositories: [{ projectId: "prj_1", name: "app" }] },
      },
      // The workspace list names every command this core answers.
      {
        kind: "core.result",
        id: 2,
        result: {
          workspaces: [],
          commands: [...applicationCommandNames, ...advertisedCoreRequestNames],
        },
      },
    ]);
    const providers = written[2]?.result as { providers: { provider: string }[] };
    expect(providers.providers.map((entry) => entry.provider)).toEqual(["claude", "codex"]);
    for (const [command, response] of [
      ["repository.list", written[0]],
      ["workspace.list", written[1]],
      ["provider.list", written[2]],
    ] as const) {
      const valid = validResult(command);
      expect(valid(response?.result), JSON.stringify(valid.errors)).toBe(true);
    }
  });

  it("answers the session host's exit report", async () => {
    const { written } = await serve([
      { kind: "session.exited", id: 1, sessionId: started.sessionId, exitCode: null },
      { kind: "session.exited", id: 2, sessionId: started.sessionId, exitCode: 300 },
    ]);
    expect(written[0]).toEqual({ kind: "core.result", id: 1, result: { status: "recorded" } });
    // A malformed report ends the link like any malformed line.
    expect(written).toHaveLength(1);
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

  it("answers decoder.interrupt with the bytes that stop the turn, or interrupt_unsupported", async () => {
    const { written } = await serve([
      { kind: "decoder.open", id: 1, decoderId: "dec_1", provider: "claude" },
      { kind: "decoder.interrupt", id: 2, decoderId: "dec_1" },
      { kind: "decoder.send", id: 3, decoderId: "dec_1", text: "Count to 300." },
      { kind: "decoder.interrupt", id: 4, decoderId: "dec_1" },
      { kind: "decoder.interrupt", id: 5, decoderId: "dec_missing" },
    ]);
    const sentInput = (id: number) =>
      Buffer.from(String(written.find((response) => response.id === id)?.input), "base64").toString(
        "utf8",
      );
    // With no turn running there is nothing to send.
    expect(sentInput(2)).toBe("");
    expect(JSON.parse(sentInput(4))).toMatchObject({
      type: "control_request",
      request: { subtype: "interrupt" },
    });
    expect(written.find((response) => response.id === 5)).toMatchObject({
      kind: "core.failed",
      code: "decoder_not_found",
    });

    // A provider whose decoder cannot stop a turn says so.
    const refused: Record<string, unknown>[] = [];
    await new CoreLinkServer(
      {
        ...handlers(),
        createDecoder: () => ({
          send: () => ({ input: new Uint8Array(), events: [] }),
          output: () => [],
        }),
      },
      (line) => refused.push(JSON.parse(line) as Record<string, unknown>),
    ).serve(
      input([
        { kind: "decoder.open", id: 1, decoderId: "dec_1", provider: "claude" },
        { kind: "decoder.interrupt", id: 2, decoderId: "dec_1" },
      ]),
    );
    expect(refused[1]).toMatchObject({ kind: "core.failed", id: 2, code: "interrupt_unsupported" });
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

  it("answers transcript pages and their failures by request", async () => {
    const { written, end } = await serve([
      { kind: "transcript.read", id: 1, workspaceId: started.workspaceId, offset: 0, limit: 500 },
      { kind: "transcript.read", id: 2, workspaceId: "wsp_missing", offset: 0, limit: 500 },
    ]);
    expect(end).toBe("input_closed");
    expect(written.find((response) => response.id === 1)).toEqual({
      kind: "transcript.page",
      id: 1,
      items: [{ content: { kind: "user_message", text: "Fix the build." }, createdAtMs: 1000 }],
      complete: true,
    });
    expect(written.find((response) => response.id === 2)).toMatchObject({
      kind: "core.failed",
      code: "workspace_not_found",
    });
  });

  it("records a named session's turn usage after answering its decoded events", async () => {
    recordedUsage.length = 0;
    const result = (uuid: string) =>
      Buffer.from(
        `${JSON.stringify({
          type: "result",
          subtype: "success",
          uuid,
          result_index: 0,
          model_usage_since_last_result: {
            "claude-haiku-5-5": { inputTokens: 1, outputTokens: 2, costUSD: 0.01 },
          },
        })}\n`,
      ).toString("base64");
    const sessionId = started.sessionId;
    const { written } = await serve([
      { kind: "core.command", id: 1, command: "workspace.list", arguments: {} },
      { kind: "decoder.open", id: 2, decoderId: "dec_1", provider: "claude", sessionId },
      { kind: "decoder.output", id: 3, decoderId: "dec_1", data: result("r1") },
      // A decoder the session host did not name records nothing.
      { kind: "decoder.open", id: 4, decoderId: "dec_2", provider: "claude" },
      { kind: "decoder.output", id: 5, decoderId: "dec_2", data: result("r2") },
    ]);
    const list = written.find((response) => response.id === 1)?.result as { commands: string[] };
    expect(list.commands).toContain("decoder.session");
    expect(list.commands).toContain("decoder.interrupt");
    expect(written.find((response) => response.id === 3)).toMatchObject({
      kind: "decoder.decoded",
    });
    expect(recordedUsage).toEqual([[sessionId, ["claude-haiku-5-5"]]]);
  });

  it("records an unnamed decoder's turns once the session host names it", async () => {
    recordedUsage.length = 0;
    const result = (uuid: string) =>
      Buffer.from(
        `${JSON.stringify({
          type: "result",
          subtype: "success",
          uuid,
          result_index: 0,
          model_usage_since_last_result: {
            "claude-haiku-5-5": { inputTokens: 1, outputTokens: 2, costUSD: 0.01 },
          },
        })}\n`,
      ).toString("base64");
    const sessionId = started.sessionId;
    const server = new CoreLinkServer(handlers(), () => undefined);
    await server.serve(
      input([
        // Opened before its process advertised decoder.session: the first turn is held.
        { kind: "decoder.open", id: 1, decoderId: "dec_1", provider: "claude" },
        { kind: "decoder.output", id: 2, decoderId: "dec_1", data: result("r1") },
        // Named before the next turn: the same decoder keeps going and the held turn records.
        { kind: "decoder.open", id: 3, decoderId: "dec_1", provider: "claude", sessionId },
        { kind: "decoder.output", id: 4, decoderId: "dec_1", data: result("r2") },
      ]),
    );
    expect(recordedUsage).toEqual([
      [sessionId, ["claude-haiku-5-5"]],
      [sessionId, ["claude-haiku-5-5"]],
    ]);
    expect(server.usage.dropped).toBe(0);
  });

  it("counts an unnamed decoder's usage past its bound as dropped", async () => {
    recordedUsage.length = 0;
    const turns = Array.from({ length: MAX_PENDING_TURN_USAGE + 3 }, (_, index) =>
      JSON.stringify({
        type: "result",
        subtype: "success",
        uuid: `r${index}`,
        result_index: index,
        model_usage_since_last_result: {
          "claude-haiku-5-5": { inputTokens: 1, outputTokens: 2, costUSD: 0.01 },
        },
      }),
    ).join("\n");
    const server = new CoreLinkServer(handlers(), () => undefined);
    await server.serve(
      input([
        { kind: "decoder.open", id: 1, decoderId: "dec_1", provider: "claude" },
        {
          kind: "decoder.output",
          id: 2,
          decoderId: "dec_1",
          data: Buffer.from(`${turns}\n`).toString("base64"),
        },
      ]),
    );
    expect(server.usage.dropped).toBe(3);
    expect(recordedUsage).toEqual([]);
  });
});
