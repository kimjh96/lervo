import {
  assertKnowledgeGraphNode,
} from "@lervo/knowledge-graph";
import {
  type HubKnowledgeGraphQuery,
  type HubProjectKnowledgeGraph,
  type HubProjectRunQuery,
  type HubProjectTrace,
  type HubProjectTraceQuery,
  type HubProjectTraceSummary,
  type HubRunEventQuery,
  type HubRunTrace,
  type HubTracePage,
  type HubTraceProjectScope,
  type ResolvedHubProjectRunQuery,
  type ResolvedHubProjectTraceQuery,
  type ResolvedHubKnowledgeGraphQuery,
  type ResolvedHubRunEventQuery,
} from "./types.js";
import { HubTraceError } from "./errors.js";
import { assertKnowledgeGraphPage } from "./knowledge-graph-page.js";

const DEFAULT_PAGE_LIMIT = 50;
export const HUB_TRACE_MAX_PAGE_LIMIT = 100;
export const HUB_TRACE_MAX_PROJECT_SCOPE = 256;

export interface HubTraceSource {
  listProjects(
    query: ResolvedHubProjectTraceQuery,
  ): Promise<HubTracePage<HubProjectTraceSummary, { destinationId: string; projectId: string }>>;
  getProject(query: ResolvedHubProjectRunQuery): Promise<HubProjectTrace | null>;
  getRun(query: ResolvedHubRunEventQuery): Promise<HubRunTrace | null>;
  getKnowledgeGraph(
    query: ResolvedHubKnowledgeGraphQuery,
  ): Promise<HubProjectKnowledgeGraph | null>;
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

function coordinateKey(input: { destinationId: string; projectId: string }): string {
  return `${input.destinationId.length}:${input.destinationId}${input.projectId}`;
}

function projectScope(
  projects: ReadonlyArray<{ destinationId: string; projectId: string }>,
): { scope: HubTraceProjectScope; keys: Set<string> } {
  if (!Array.isArray(projects) || projects.length > HUB_TRACE_MAX_PROJECT_SCOPE) {
    throw new HubTraceError(
      "invalid_query",
      `Hub trace project scope는 ${HUB_TRACE_MAX_PROJECT_SCOPE}개 이하여야 합니다.`,
    );
  }
  const unique = new Map<string, { destinationId: string; projectId: string }>();
  for (const coordinate of projects) {
    assertProjectCoordinate(coordinate);
    unique.set(coordinateKey(coordinate), clone(coordinate));
  }
  const normalized = [...unique.values()].sort((left, right) =>
    left.destinationId.localeCompare(right.destinationId) || left.projectId.localeCompare(right.projectId)
  );
  return {
    scope: { mode: "projects", projects: normalized },
    keys: new Set(normalized.map(coordinateKey)),
  };
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

class HubTraceQueryReader {
  constructor(
    private readonly source: HubTraceSource,
    private readonly scope: HubTraceProjectScope,
    private readonly authorizedProjects: Set<string> | null,
  ) {}

  private assertAuthorized(input: { destinationId: string; projectId: string }): void {
    if (this.authorizedProjects !== null && !this.authorizedProjects.has(coordinateKey(input))) {
      throw new HubTraceError("project_forbidden", "요청한 Hub project trace에 접근할 수 없습니다.");
    }
  }

  async listProjects(
    query: HubProjectTraceQuery = {},
  ): Promise<HubTracePage<HubProjectTraceSummary, { destinationId: string; projectId: string }>> {
    if (query.after !== undefined) assertProjectCoordinate(query.after);
    const limit = resolvedLimit(query.limit);
    const result = await this.source.listProjects({
      scope: clone(this.scope),
      ...(query.after === undefined ? {} : { after: clone(query.after) }),
      limit,
    });
    assertBoundedPage(result, limit, "Hub project trace");
    if (this.authorizedProjects !== null && (
      result.items.some((item) => !this.authorizedProjects!.has(coordinateKey(item))) ||
      (result.nextCursor !== null && !this.authorizedProjects.has(coordinateKey(result.nextCursor)))
    )) {
      throw new HubTraceError(
        "source_inconsistent",
        "Hub project trace source가 허용 scope 밖의 결과를 반환했습니다.",
      );
    }
    return clone(result);
  }

  async getProject(query: HubProjectRunQuery): Promise<HubProjectTrace> {
    assertProjectCoordinate(query);
    this.assertAuthorized(query);
    if (query.after !== undefined) {
      assertPositiveSeq(query.after.firstSeq, "run");
      assertText(query.after.runId, "runId");
    }
    const limit = resolvedLimit(query.limit);
    const result = await this.source.getProject({
      scope: clone(this.scope),
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
    this.assertAuthorized(query);
    assertText(query.runId, "runId");
    if (query.after !== undefined) assertPositiveSeq(query.after.seq, "event");
    const limit = resolvedLimit(query.limit);
    const result = await this.source.getRun({
      scope: clone(this.scope),
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

  async getKnowledgeGraph(query: HubKnowledgeGraphQuery): Promise<HubProjectKnowledgeGraph> {
    assertProjectCoordinate(query);
    this.assertAuthorized(query);
    assertKnowledgeGraphNode(query.focus);
    if (query.after !== undefined && !/^kgr_[a-f0-9]{16}$/.test(query.after.relationId)) {
      throw new HubTraceError("invalid_query", "knowledge graph cursor가 유효하지 않습니다.");
    }
    const limit = resolvedLimit(query.limit);
    const resolved: ResolvedHubKnowledgeGraphQuery = {
      scope: clone(this.scope),
      destinationId: query.destinationId,
      projectId: query.projectId,
      focus: clone(query.focus),
      ...(query.after === undefined ? {} : { after: clone(query.after) }),
      limit,
    };
    const result = await this.source.getKnowledgeGraph(resolved);
    if (result === null) {
      throw new HubTraceError("project_not_found", "요청한 Hub project trace가 없습니다.");
    }
    assertKnowledgeGraphPage({ query: resolved, result });
    return clone(result);
  }
}

export class HubTraceReader extends HubTraceQueryReader {
  constructor(source: HubTraceSource) {
    super(source, { mode: "all" }, null);
  }
}

export class HubProjectScopedTraceReader extends HubTraceQueryReader {
  constructor(source: HubTraceSource, projects: ReadonlyArray<{
    destinationId: string;
    projectId: string;
  }>) {
    const normalized = projectScope(projects);
    super(source, normalized.scope, normalized.keys);
  }
}
