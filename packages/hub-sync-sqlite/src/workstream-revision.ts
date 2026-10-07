import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";
import type { WorkstreamSnapshot } from "@lervo/schemas";

export interface RevisionRow {
  snapshot_content_hash: string;
  previous_snapshot_content_hash: string | null;
  workstream_id: string;
  revision: number;
  status: WorkstreamSnapshot["status"];
  snapshot_json: string;
  published_at: string;
  is_head: number;
}

export const MAX_WORKSTREAM_HEADS = 16;

export function snapshotJson(snapshot: WorkstreamSnapshot): string {
  return `${canonicalJson(snapshot)}\n`;
}

export function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}
