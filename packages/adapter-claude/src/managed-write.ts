import {
  createManagedWriteCompletion,
  createManagedWriteRequest,
} from "@roven/adapter-contract";
import type {
  AdapterManagedWriteCompletion,
  AdapterManagedWriteRequest,
  AdapterSession,
  AdapterTurn,
} from "@roven/schemas";

import { asRecord, digest, repositoryPath, text } from "./normalization-utils.js";
import { ClaudeAdapterError } from "./types.js";

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
