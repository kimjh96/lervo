import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";

export function syncContentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function syncContentId(prefix: "hpr" | "hsb", value: unknown): string {
  return `${prefix}_${syncContentHash(value).slice("sha256:".length)}`;
}
