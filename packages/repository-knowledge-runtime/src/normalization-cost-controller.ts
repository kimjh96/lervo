import { resolve } from "node:path";
import {
  canonicalJson,
  sha256,
  type DocumentNormalizationCompilerDescriptor,
} from "@lervo/repository-knowledge";
import { normalizationReviewResponseSchema } from "./normalization-review.js";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

const PATH = ".lervo/state/knowledge/normalization-cost-controller.json";
interface Limit {
  documents: number;
  successes: number;
}

export function normalizationCostKey(
  compiler: DocumentNormalizationCompilerDescriptor,
  size: number,
): string {
  return sha256(
    canonicalJson([
      compiler,
      normalizationReviewResponseSchema,
      size <= 16_384 ? "small" : size <= 65_536 ? "medium" : "large",
    ]),
  );
}

async function readLimits(root: string): Promise<Record<string, Limit>> {
  const read = await readPrivateJsonFile(resolve(root, PATH), 16_384);
  const value =
    read.status === "read"
      ? (read.value as { schemaVersion?: unknown; limits?: Record<string, Limit> } | null)
      : null;
  if (
    value?.schemaVersion !== 1 ||
    value.limits === undefined ||
    typeof value.limits !== "object" ||
    value.limits === null ||
    Object.keys(value.limits).length > 64
  )
    return {};
  return Object.fromEntries(
    Object.entries(value.limits).filter(
      ([key, limit]) =>
        /^sha256:[a-f0-9]{64}$/u.test(key) &&
        limit !== null &&
        Number.isSafeInteger(limit.documents) &&
        limit.documents > 0 &&
        limit.documents <= 256 &&
        Number.isInteger(limit.successes) &&
        limit.successes >= 0 &&
        limit.successes <= 3,
    ),
  );
}

export async function normalizationLearnedLimit(
  root: string,
  key: string,
  ceiling: number,
): Promise<number> {
  return Math.min(ceiling, (await readLimits(root))[key]?.documents ?? ceiling);
}

export async function recordNormalizationReviewCost(input: {
  root: string;
  key: string;
  documents: number;
  ceiling: number;
  outcome: "timeout" | "success";
}): Promise<void> {
  const limits = await readLimits(input.root);
  const previous = limits[input.key] ?? { documents: input.documents, successes: 0 };
  const successes = input.outcome === "timeout" ? 0 : Math.min(3, previous.successes + 1);
  limits[input.key] =
    input.outcome === "timeout"
      ? { documents: Math.max(1, Math.floor(input.documents / 2)), successes: 0 }
      : {
          documents: Math.min(
            input.ceiling,
            successes === 3 ? previous.documents + 1 : previous.documents,
          ),
          successes: successes === 3 ? 0 : successes,
        };
  await writePrivateJsonFile(resolve(input.root, PATH), {
    schemaVersion: 1,
    limits: Object.fromEntries(Object.entries(limits).slice(-64)),
  });
}
