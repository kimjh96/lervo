export class TraceApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "TraceApiError";
    this.status = status;
    this.code = code;
  }
}

function query(parameters) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== undefined) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new TraceApiError(response.status, "invalid_response", "Could not validate the Hub response format.");
  }
  try {
    return await response.json();
  } catch {
    throw new TraceApiError(response.status, "invalid_response", "Could not read the Hub response.");
  }
}

export function createTraceApi(readToken) {
  async function request(path) {
    const token = readToken();
    if (typeof token !== "string" || token.length === 0) {
      throw new TraceApiError(401, "unauthorized", "An access token is required.");
    }
    let response;
    try {
      response = await fetch(path, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new TraceApiError(0, "network_error", "Could not connect to the Hub.");
    }
    const body = await readJson(response);
    if (!response.ok) {
      const code = typeof body?.error?.code === "string" ? body.error.code : "request_failed";
      const message = typeof body?.error?.message === "string"
        ? body.error.message
        : "Could not load the trace.";
      throw new TraceApiError(response.status, code, message);
    }
    if (body?.schemaVersion !== 1) {
      throw new TraceApiError(response.status, "invalid_response", "The Hub response is not supported.");
    }
    return body;
  }

  return {
    listProjects(cursor, limit) {
      return request(`/v1/trace/projects${query({ cursor, limit })}`);
    },
    getProject(project, cursor, limit) {
      const projectId = encodeURIComponent(project.projectId);
      return request(`/v1/trace/projects/${projectId}${query({
        destinationId: project.destinationId,
        cursor,
        limit,
      })}`);
    },
    getRun(project, runId, cursor, limit) {
      const projectId = encodeURIComponent(project.projectId);
      const encodedRunId = encodeURIComponent(runId);
      return request(`/v1/trace/projects/${projectId}/runs/${encodedRunId}${query({
        destinationId: project.destinationId,
        cursor,
        limit,
      })}`);
    },
    getKnowledgeGraph(project, focus, cursor, limit) {
      const projectId = encodeURIComponent(project.projectId);
      return request(`/v1/trace/projects/${projectId}/graph${query({
        destinationId: project.destinationId,
        focusKind: focus.kind,
        focusId: focus.id,
        cursor,
        limit,
      })}`);
    },
  };
}
