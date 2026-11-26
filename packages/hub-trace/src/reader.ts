import { assertKnowledgeGraphNode } from "@lervo/knowledge-graph";
import { projectWorkExecutionReport } from "@lervo/execution-observability";
import {
  type HubKnowledgeGraphQuery,
  type HubProjectKnowledgeGraph,
  type HubProjectRunQuery,
  type HubProjectTrace,
  type HubProjectTraceQuery,
  type HubProjectTraceSummary,
  type HubRunEventQuery,
  type HubRunTrace,
  type HubWorkTrace,
  type HubWorkTraceQuery,
  type HubTracePage,
  type HubTraceProjectScope,
  type ResolvedHubProjectRunQuery,
  type ResolvedHubProjectTraceQuery,
  type ResolvedHubKnowledgeGraphQuery,
  type ResolvedHubRunEventQuery,
  type ResolvedHubWorkTraceQuery,
  type HubWorkTraceSource,
} from "./types.js";
import { HubTraceError } from "./errors.js";
import { assertKnowledgeGraphPage } from "./knowledge-graph-page.js";
import { validateSchema } from "@lervo/schemas";

const DEFAULT_PAGE_LIMIT = 50;
export const HUB_TRACE_MAX_PAGE_LIMIT = 100;
export const HUB_TRACE_MAX_PROJECT_SCOPE = 256;

export interface HubTraceSource {
  listProjects(
    query: ResolvedHubProjectTraceQuery,
  ): Promise<HubTracePage<HubProjectTraceSummary, { destinationId: string; projectId: string }>>;
  getProject(query: ResolvedHubProjectRunQuery): Promise<HubProjectTrace | null>;
  getRun(query: ResolvedHubRunEventQuery): Promise<HubRunTrace | null>;
  getWork(query: ResolvedHubWorkTraceQuery): Promise<HubWorkTraceSource | null>;
  getKnowledgeGraph(
    query: ResolvedHubKnowledgeGraphQuery,
  ): Promise<HubProjectKnowledgeGraph | null>;
}

export const HUB_TRACE_MAX_WORK_EVENTS = 100_000;

function resolvedLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > HUB_TRACE_MAX_PAGE_LIMIT) {
    throw new HubTraceError(
      "invalid_query",
      `The Hub trace page limit must be between 1 and ${HUB_TRACE_MAX_PAGE_LIMIT}.`,
    );
  }
  return value;
}

function assertText(value: string, name: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new HubTraceError("invalid_query", `${name} query coordinates are invalid.`);
  }
}

function assertProjectCoordinate(input: { destinationId: string; projectId: string }): void {
  assertText(input.destinationId, "destinationId");
  assertText(input.projectId, "projectId");
}

function coordinateKey(input: { destinationId: string; projectId: string }): string {
  return `${input.destinationId.length}:${input.destinationId}${input.projectId}`;
}

function projectScope(projects: ReadonlyArray<{ destinationId: string; projectId: string }>): {
  scope: HubTraceProjectScope;
  keys: Set<string>;
} {
  if (!Array.isArray(projects) || projects.length > HUB_TRACE_MAX_PROJECT_SCOPE) {
    throw new HubTraceError(
      "invalid_query",
      `The Hub trace project scope must contain at most ${HUB_TRACE_MAX_PROJECT_SCOPE} projects.`,
    );
  }
  const unique = new Map<string, { destinationId: string; projectId: string }>();
  for (const coordinate of projects) {
    assertProjectCoordinate(coordinate);
    unique.set(coordinateKey(coordinate), clone(coordinate));
  }
  const normalized = [...unique.values()].sort(
    (left, right) =>
      left.destinationId.localeCompare(right.destinationId) ||
      left.projectId.localeCompare(right.projectId),
  );
  return {
    scope: { mode: "projects", projects: normalized },
    keys: new Set(normalized.map(coordinateKey)),
  };
}

function assertPositiveSeq(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new HubTraceError("invalid_query", `${name} cursor is invalid.`);
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
  if (
    !Array.isArray(page.items) ||
    page.items.length > limit ||
    (page.items.length === 0 && page.nextCursor !== null)
  ) {
    throw new HubTraceError(
      "source_inconsistent",
      `${label} source did not satisfy the bounded-page contract.`,
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
      throw new HubTraceError(
        "project_forbidden",
        "The requested Hub project trace is not accessible.",
      );
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
    if (
      this.authorizedProjects !== null &&
      (result.items.some((item) => !this.authorizedProjects!.has(coordinateKey(item))) ||
        (result.nextCursor !== null &&
          !this.authorizedProjects.has(coordinateKey(result.nextCursor))))
    ) {
      throw new HubTraceError(
        "source_inconsistent",
        "The Hub project trace source returned a result outside the allowed scope.",
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
      throw new HubTraceError(
        "project_not_found",
        "The requested Hub project trace was not found.",
      );
    }
    assertBoundedPage(result.runs, limit, "Hub run summary");
    if (
      result.project.destinationId !== query.destinationId ||
      result.project.projectId !== query.projectId
    ) {
      throw new HubTraceError(
        "source_inconsistent",
        "The Hub project trace coordinates differ from the request.",
      );
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
      throw new HubTraceError("run_not_found", "The requested Hub run trace was not found.");
    }
    assertBoundedPage(result.events, limit, "Hub run event");
    if (
      result.project.destinationId !== query.destinationId ||
      result.project.projectId !== query.projectId ||
      result.run.runId !== query.runId
    ) {
      throw new HubTraceError(
        "source_inconsistent",
        "The Hub run trace coordinates differ from the request.",
      );
    }
    if (
      result.contextCoverage !== null &&
      (!validateSchema("managedContextCoverageReport", result.contextCoverage).valid ||
        result.contextCoverage.projectId !== query.projectId ||
        result.contextCoverage.runId !== query.runId)
    ) {
      throw new HubTraceError(
        "source_inconsistent",
        "The Hub managed context coverage differs from the requested run.",
      );
    }
    return clone(result);
  }

  async getWork(query: HubWorkTraceQuery): Promise<HubWorkTrace> {
    assertProjectCoordinate(query);
    this.assertAuthorized(query);
    if (!/^wrk_[a-f0-9]{24}$/.test(query.workId)) {
      throw new HubTraceError("invalid_query", "The work ID is invalid.");
    }
    const result = await this.source.getWork({
      scope: clone(this.scope),
      destinationId: query.destinationId,
      projectId: query.projectId,
      workId: query.workId,
    });
    if (result === null) {
      throw new HubTraceError("work_not_found", "The requested Hub work trace was not found.");
    }
    if (
      result.project.destinationId !== query.destinationId ||
      result.project.projectId !== query.projectId ||
      result.events.length > HUB_TRACE_MAX_WORK_EVENTS ||
      result.events.some((event) => event.projectId !== query.projectId)
    ) {
      throw new HubTraceError(
        "source_inconsistent",
        "The Hub work trace source differs from the requested bounded project coordinates.",
      );
    }
    try {
      return {
        project: clone(result.project),
        report: projectWorkExecutionReport({
          projectId: query.projectId,
          workId: query.workId,
          events: result.events,
        }),
      };
    } catch (error) {
      if ((error as { code?: unknown })?.code === "work_not_found") {
        throw new HubTraceError("work_not_found", "The requested Hub work trace was not found.", {
          cause: error,
        });
      }
      throw new HubTraceError(
        "source_inconsistent",
        "The Hub work trace source could not be projected.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  async getKnowledgeGraph(query: HubKnowledgeGraphQuery): Promise<HubProjectKnowledgeGraph> {
    assertProjectCoordinate(query);
    this.assertAuthorized(query);
    assertKnowledgeGraphNode(query.focus);
    if (query.after !== undefined && !/^kgr_[a-f0-9]{16}$/.test(query.after.relationId)) {
      throw new HubTraceError("invalid_query", "The knowledge graph cursor is invalid.");
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
      throw new HubTraceError(
        "project_not_found",
        "The requested Hub project trace was not found.",
      );
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
  constructor(
    source: HubTraceSource,
    projects: ReadonlyArray<{
      destinationId: string;
      projectId: string;
    }>,
  ) {
    const normalized = projectScope(projects);
    super(source, normalized.scope, normalized.keys);
  }
}
