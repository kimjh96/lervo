import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";

export function slackAssignmentDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function slackAssignmentBytesDigest(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function slackAssignmentOpaqueId(prefix: "acres", value: unknown): string {
  return `${prefix}_${slackAssignmentDigest(value).slice(7, 31)}`;
}
