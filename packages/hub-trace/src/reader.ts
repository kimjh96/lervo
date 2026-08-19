import {
  type HubProjectRunQuery,
  type HubProjectTrace,
  type HubProjectTraceQuery,
  type HubProjectTraceSummary,
  type HubRunEventQuery,
  type HubRunTrace,
  type HubTracePage,
  type ResolvedHubProjectRunQuery,
  type ResolvedHubProjectTraceQuery,
  type ResolvedHubRunEventQuery,
} from "./types.js";
import { HubTraceError } from "./errors.js";

const DEFAULT_PAGE_LIMIT = 50;
export const HUB_TRACE_MAX_PAGE_LIMIT = 100;

export interface HubTraceSource {
  listProjects(
    query: ResolvedHubProjectTraceQuery,
  ): Promise<HubTracePage<HubProjectTraceSummary, { destinationId: string; projectId: string }>>;
  getProject(query: ResolvedHubProjectRunQuery): Promise<HubProjectTrace | null>;
  getRun(query: ResolvedHubRunEventQuery): Promise<HubRunTrace | null>;
}

function resolvedLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > HUB_TRACE_MAX_PAGE_LIMIT) {
    throw new HubTraceError(
      "invalid_query",
      `Hub trace page limit은 1 이상 ${HUB_TRACE_MAX_PAGE_LIMIT} 이하여야 합니다.`,
    );
  }
  return value;
}

function assertText(value: string, name: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new HubTraceError("invalid_query", `${name} 조회 좌표가 유효하지 않습니다.`);
  }
}

function assertProjectCoordinate(input: { destinationId: string; projectId: string }): void {
  assertText(input.destinationId, "destinationId");
  assertText(input.projectId, "projectId");
}

function assertPositiveSeq(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new HubTraceError("invalid_query", `${name} cursor가 유효하지 않습니다.`);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertBoundedPage<T, Cursor>(
  page: HubTracePage<T, Cursor>,
  limit: number,
  label: string,
): void {
  if (!Array.isArray(page.items) || page.items.length > limit || (
    page.items.length === 0 && page.nextCursor !== null
  )) {
    throw new HubTraceError(
      "source_inconsistent",
      `${label} source가 bounded page 계약을 지키지 않았습니다.`,
    );
  }
}

export class HubTraceReader {
  constructor(private readonly source: HubTraceSource) {}

  async listProjects(
    query: HubProjectTraceQuery = {},
  ): Promise<HubTracePage<HubProjectTraceSummary, { destinationId: string; projectId: string }>> {
    if (query.after !== undefined) assertProjectCoordinate(query.after);
    const limit = resolvedLimit(query.limit);
    const result = await this.source.listProjects({
      ...(query.after === undefined ? {} : { after: clone(query.after) }),
      limit,
    });
    assertBoundedPage(result, limit, "Hub project trace");
    return clone(result);
  }

  async getProject(query: HubProjectRunQuery): Promise<HubProjectTrace> {
    assertProjectCoordinate(query);
    if (query.after !== undefined) {
      assertPositiveSeq(query.after.firstSeq, "run");
      assertText(query.after.runId, "runId");
    }
    const limit = resolvedLimit(query.limit);
    const result = await this.source.getProject({
      destinationId: query.destinationId,
      projectId: query.projectId,
      ...(query.after === undefined ? {} : { after: clone(query.after) }),
      limit,
    });
    if (result === null) {
      throw new HubTraceError("project_not_found", "요청한 Hub project trace가 없습니다.");
    }
    assertBoundedPage(result.runs, limit, "Hub run summary");
    if (
      result.project.destinationId !== query.destinationId ||
      result.project.projectId !== query.projectId
    ) {
      throw new HubTraceError("source_inconsistent", "Hub project trace 좌표가 요청과 다릅니다.");
    }
    return clone(result);
  }

  async getRun(query: HubRunEventQuery): Promise<HubRunTrace> {
    assertProjectCoordinate(query);
    assertText(query.runId, "runId");
    if (query.after !== undefined) assertPositiveSeq(query.after.seq, "event");
    const limit = resolvedLimit(query.limit);
    const result = await this.source.getRun({
      destinationId: query.destinationId,
      projectId: query.projectId,
      runId: query.runId,
      ...(query.after === undefined ? {} : { after: clone(query.after) }),
      limit,
    });
    if (result === null) {
      throw new HubTraceError("run_not_found", "요청한 Hub run trace가 없습니다.");
    }
    assertBoundedPage(result.events, limit, "Hub run event");
    if (
      result.project.destinationId !== query.destinationId ||
      result.project.projectId !== query.projectId ||
      result.run.runId !== query.runId
    ) {
      throw new HubTraceError("source_inconsistent", "Hub run trace 좌표가 요청과 다릅니다.");
    }
    return clone(result);
  }
}
