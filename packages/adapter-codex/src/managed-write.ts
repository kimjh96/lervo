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

import {
  asRecord,
  digest,
  eventTime,
  fileKind,
  providerThreadId,
  repositoryPath,
  text,
} from "./normalization-utils.js";

export type CodexServerRequestId = string | number;

export interface CodexWriteProposal {
  providerItemId: string;
  path: string;
  targetDigest: string;
  changeKind: AdapterManagedWriteRequest["changeKind"];
}

export function codexWriteApprovalRequestId(raw: unknown): CodexServerRequestId | null {
  const message = asRecord(raw);
  if (
    message?.method !== "item/fileChange/requestApproval" ||
    (typeof message.id !== "string" && typeof message.id !== "number")
  ) {
    return null;
  }
  return message.id;
}

export function captureCodexWriteProposal(input: {
  raw: unknown;
  repositoryRoot: string;
  providerSessionId: string;
  providerTurnId: string;
}): CodexWriteProposal | null {
  const message = asRecord(input.raw);
  const method = text(message?.method);
  const params = asRecord(message?.params);
  if (method !== "item/started" || params === undefined) return null;
  if (
    providerThreadId(method, params) !== input.providerSessionId ||
    text(params.turnId) !== input.providerTurnId
  ) {
    return null;
  }
  const item = asRecord(params.item);
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  const change = changes.length === 1 ? asRecord(changes[0]) : undefined;
  const providerItemId = text(item?.id);
  const path = repositoryPath(input.repositoryRoot, change?.path);
  const kind = fileKind(change?.kind);
  if (
    item?.type !== "fileChange" ||
    providerItemId === undefined ||
    path === null ||
    kind === "moved"
  ) {
    return null;
  }
  return {
    providerItemId,
    path,
    targetDigest: digest({ path, kind, diff: change?.diff }),
    changeKind: kind,
  };
}

export function captureCodexWriteApproval(input: {
  raw: unknown;
  session: AdapterSession;
  turn: AdapterTurn;
  proposal: CodexWriteProposal | undefined;
  now: () => Date;
}): { requestId: CodexServerRequestId; request: AdapterManagedWriteRequest } | null {
  const message = asRecord(input.raw);
  const params = asRecord(message?.params);
  const requestId = message?.id;
  const proposal = input.proposal;
  if (
    message?.method !== "item/fileChange/requestApproval" ||
    params === undefined ||
    (typeof requestId !== "string" && typeof requestId !== "number") ||
    text(params.threadId) !== input.session.providerSessionId ||
    text(params.turnId) !== input.turn.providerTurnId ||
    proposal === undefined ||
    text(params.itemId) !== proposal.providerItemId
  ) {
    return null;
  }
  return {
    requestId,
    request: createManagedWriteRequest({
      session: input.session,
      turn: input.turn,
      ...proposal,
      requestedAt: input.now().toISOString(),
    }),
  };
}

export function captureCodexWriteCompletion(input: {
  raw: unknown;
  request: AdapterManagedWriteRequest;
  now: () => Date;
}): AdapterManagedWriteCompletion | null {
  const message = asRecord(input.raw);
  const params = asRecord(message?.params);
  const item = asRecord(params?.item);
  if (
    message?.method !== "item/completed" ||
    text(params?.threadId) !== input.request.providerSessionId ||
    text(params?.turnId) !== input.request.providerTurnId ||
    item?.type !== "fileChange" ||
    text(item.id) !== input.request.providerItemId
  ) {
    return null;
  }
  const status =
    item.status === "completed"
      ? "completed"
      : item.status === "declined"
        ? "declined"
        : "failed";
  return createManagedWriteCompletion({
    request: input.request,
    status,
    completedAt: eventTime(message, params ?? {}, input.now),
  });
}
