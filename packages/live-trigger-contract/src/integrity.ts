import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";

export const LIVE_TRIGGER_HASH = /^sha256:[a-f0-9]{64}$/u;
export const LIVE_TRIGGER_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
export const LIVE_TRIGGER_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;

export function liveTriggerHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function liveTriggerBytesHash(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function liveTriggerId(prefix: "lwa" | "ltp" | "ltr", value: unknown): string {
  return `${prefix}_${liveTriggerHash(value).slice("sha256:".length, "sha256:".length + 24)}`;
}
