import {
  createManagedWriteCompletion,
  createManagedWriteRequest,
  inspectManagedWriteDecisionBinding,
  type ProviderManagedWriteBridge,
} from "@lervo/adapter-contract";
import type {
  AdapterManagedWriteCompletion,
  AdapterManagedWriteRequest,
  AdapterSession,
  AdapterTurn,
} from "@lervo/schemas";

import { asRecord, digest, repositoryPath, text } from "./normalization-utils.js";
import { assertAdapterMessage, clone } from "./adapter-validation.js";
import {
  ClaudeAdapterError,
  type ClaudeManagedWriteHandler,
} from "./types.js";

export function createClaudeManagedWriteRequest(input: {
  session: AdapterSession;
  turn: AdapterTurn;
  repositoryRoot: string;
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  requestedAt: string;
}): AdapterManagedWriteRequest {
  const toolInput = asRecord(input.toolInput);
  const path = repositoryPath(input.repositoryRoot, toolInput?.file_path);
  const changeKind =
    input.toolName === "Write"
      ? "upsert"
      : input.toolName === "Edit"
        ? "modified"
        : null;
  if (path === null || changeKind === null || text(input.toolUseId) === undefined) {
    throw new ClaudeAdapterError(
      "invalid_request",
      "Claude managed write 도구의 경로나 종류가 유효하지 않습니다.",
    );
  }
  return createManagedWriteRequest({
    session: input.session,
    turn: input.turn,
    providerItemId: input.toolUseId,
    path,
    targetDigest: digest({ toolName: input.toolName, input: input.toolInput }),
    changeKind,
    requestedAt: input.requestedAt,
  });
}

export function createClaudeManagedWriteCompletion(input: {
  request: AdapterManagedWriteRequest;
  status: "completed" | "failed";
  completedAt: string;
}): AdapterManagedWriteCompletion {
  return createManagedWriteCompletion({
    request: input.request,
    status: input.status,
    completedAt: input.completedAt,
  });
}

export class ClaudeManagedWriteController implements ClaudeManagedWriteHandler {
  private readonly approved = new Map<string, AdapterManagedWriteRequest>();

  constructor(
    private readonly options: {
      session: AdapterSession;
      activeTurn: () => AdapterTurn | undefined;
      repositoryRoot: string;
      bridge: ProviderManagedWriteBridge;
      now: () => Date;
    },
  ) {}

  async authorize(toolName: string, toolInput: unknown, toolUseId: string): Promise<boolean> {
    const turn = this.options.activeTurn();
    if (turn === undefined) {
      throw new ClaudeAdapterError("provider_protocol_failed", "Turn 밖에서 write 도구를 요청했습니다.");
    }
    const request = createClaudeManagedWriteRequest({
      session: this.options.session,
      turn,
      repositoryRoot: this.options.repositoryRoot,
      toolName,
      toolInput,
      toolUseId,
      requestedAt: this.options.now().toISOString(),
    });
    assertAdapterMessage(request, "Claude managed write request");
    const decision = await this.options.bridge.authorize(request);
    assertAdapterMessage(decision, "Claude managed write decision");
    if (!inspectManagedWriteDecisionBinding({ request, decision }).passed) {
      throw new ClaudeAdapterError(
        "provider_protocol_failed",
        "Managed write 결정이 Claude 요청과 다릅니다.",
      );
    }
    if (decision.decision !== "allow") return false;
    this.approved.set(toolUseId, clone(request));
    return true;
  }

  async complete(
    _toolName: string,
    _toolInput: unknown,
    toolUseId: string,
    status: "completed" | "failed",
  ): Promise<void> {
    const request = this.approved.get(toolUseId);
    if (request === undefined) return;
    await this.options.bridge.complete(
      createClaudeManagedWriteCompletion({
        request,
        status,
        completedAt: this.options.now().toISOString(),
      }),
    );
    this.approved.delete(toolUseId);
  }

  clear(): void {
    this.approved.clear();
  }
}
