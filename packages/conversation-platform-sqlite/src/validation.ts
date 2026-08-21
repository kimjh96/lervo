import type { ConversationPlatformKind } from "@lervo/conversation-platform";

import { ConversationPlatformSQLiteError } from "./errors.js";

const patterns = {
  integrationId: /^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/,
  projectId: /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/,
  conversationId: /^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/,
  threadId: /^thd_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/,
  participantId: /^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/,
  roleId: /^[a-z][a-z0-9_-]{0,99}$/,
  eventId: /^cve_[a-f0-9]{64}$/,
  outboundId: /^cvo_[a-f0-9]{64}$/,
  hash: /^sha256:[a-f0-9]{64}$/,
} as const;

export function assertPlatform(value: string): asserts value is ConversationPlatformKind {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) invalid("platform");
}

export function assertExternal(value: string, label: string): void {
  if (value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) invalid(label);
}

export function assertIdentifier(value: string, kind: keyof typeof patterns): void {
  if (!patterns[kind].test(value)) invalid(kind);
}

export function assertDepth(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8) invalid("automation depth");
}

export function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) invalid(label);
}

function invalid(label: string): never {
  throw new ConversationPlatformSQLiteError(
    "integrity_failed",
    `${label} 값이 conversation platform 계약과 맞지 않습니다.`,
  );
}
