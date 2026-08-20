import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import {
  createSearchAssessment,
  searchFailureReasons,
  searchSourceKinds,
  type SearchAssessmentSource,
  type SearchFailureReason,
} from "@lervo/search";
import { LocalSearchObservationStore } from "@lervo/search-local";

import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchAssessment } from "./search-format.js";
import type { CliIo } from "./types.js";

function sourceCoordinates(values: string[] | undefined): SearchAssessmentSource[] {
  return (values ?? []).map((value) => {
    const separator = value.indexOf(":");
    const sourceKind = value.slice(0, separator) as SearchAssessmentSource["sourceKind"];
    const sourceId = value.slice(separator + 1);
    if (separator < 1 || !searchSourceKinds.includes(sourceKind) || sourceId.length === 0) {
      throw new Error(`검색 원본 좌표는 <source-kind>:<source-id> 형식이어야 합니다: ${value}`);
    }
    return { sourceKind, sourceId };
  });
}

export async function runSearchAssessmentCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        outcome: { type: "string" },
        reason: { type: "string" },
        selected: { type: "string", multiple: true },
        expected: { type: "string", multiple: true },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.positionals.length !== 1 || !["accepted", "failed"].includes(parsed.values.outcome ?? "")) {
    io.stderr(`검색 시도 ID와 accepted 또는 failed outcome이 필요합니다.\n${searchUsage}\n`);
    return 1;
  }
  const reason = parsed.values.reason as SearchFailureReason | undefined;
  if (reason !== undefined && !searchFailureReasons.includes(reason)) {
    io.stderr(`알 수 없는 검색 실패 사유입니다: ${reason}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const [manifest, store] = await Promise.all([
      loadProjectManifest(root),
      LocalSearchObservationStore.openExisting(root),
    ]);
    if (store === null) throw new Error("기록된 검색 시도가 없습니다.");
    const attempt = await store.readAttempt(parsed.positionals[0]!);
    if (attempt.projectId !== manifest.projectId) throw new Error("검색 시도의 project 좌표가 다릅니다.");
    const assessment = createSearchAssessment({
      attempt,
      assessedAt: new Date(),
      assessor: "human",
      outcome: parsed.values.outcome as "accepted" | "failed",
      ...(reason === undefined ? {} : { failureReason: reason }),
      selectedSources: sourceCoordinates(parsed.values.selected),
      expectedSources: sourceCoordinates(parsed.values.expected),
    });
    await store.recordAssessment(assessment);
    io.stdout(parsed.values.json
      ? `${JSON.stringify(assessment, null, 2)}\n`
      : formatSearchAssessment(assessment));
    return 0;
  } catch (error) {
    io.stderr(`검색 평가를 기록하지 못했습니다. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  }
}
