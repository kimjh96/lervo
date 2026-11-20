import { parse } from "yaml";

import { sha256 } from "./integrity.js";

/** Bounds the remembered contents; an overflow forgets them all and only costs re-decoding. */
const MAXIMUM_REMEMBERED_RECORDS = 50_000;
const current = new Set<string>();

/**
 * ADR-0601: the decoded record when a document normalization record still carries schema
 * version 1, otherwise null. Contents already decoded as a later version are remembered by their
 * hash, so a long-lived planner reads every record's bytes but decodes only new contents.
 */
export function legacyNormalizationRecord(source: string): Record<string, unknown> | null {
  const key = sha256(source);
  if (current.has(key)) return null;
  const value = parse(source) as Record<string, unknown>;
  if (value.schemaVersion === 1) return value;
  if (current.size >= MAXIMUM_REMEMBERED_RECORDS) current.clear();
  current.add(key);
  return null;
}
