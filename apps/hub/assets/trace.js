import { createTraceApi, TraceApiError } from "/assets/trace-api.js";
import { createKnowledgeGraphController } from "/assets/trace-graph-controller.js";
import { loadFirstPage, moveCursorPage } from "/assets/trace-navigation.js";
import { createCursorPager } from "/assets/trace-pagination.js";
import {
  clearTracePane,
  renderEvents,
  renderProjects,
  renderRuns,
  setPagination,
  setPaneState,
} from "/assets/trace-render.js";

const PAGE_LIMIT = 20;

function element(id) {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Required page element is missing: ${id}`);
  return value;
}

const ui = {
  authForm: element("auth-form"),
  token: element("token"),
  disconnect: element("disconnect"),
  connectionStatus: element("connection-status"),
  workspace: element("workspace"),
  projectsList: element("projects-list"),
  projectsState: element("projects-state"),
  projectsPage: element("projects-page"),
  projectsPrevious: element("projects-previous"),
  projectsNext: element("projects-next"),
  runsList: element("runs-list"),
  runsState: element("runs-state"),
  runsPage: element("runs-page"),
  runsPrevious: element("runs-previous"),
  runsNext: element("runs-next"),
  runsHelp: element("runs-help"),
  eventsList: element("events-list"),
  eventsState: element("events-state"),
  eventsPage: element("events-page"),
  eventsPrevious: element("events-previous"),
  eventsNext: element("events-next"),
  eventsHelp: element("events-help"),
  graphViewport: element("graph-viewport"),
  graphState: element("graph-state"),
  graphPage: element("graph-page"),
  graphPrevious: element("graph-previous"),
  graphNext: element("graph-next"),
  graphHelp: element("graph-help"),
};

let bearerToken = "";
let projectsPager = null;
let runsPager = null;
let eventsPager = null;
let projects = [];
let runs = [];
let selectedProject = null;
let selectedRunId = null;

const api = createTraceApi(() => bearerToken);

function connectionMessage(message, error = false) {
  ui.connectionStatus.textContent = message;
  ui.connectionStatus.classList.toggle("error", error);
}

function emptyNavigation(prefix) {
  setPagination(prefix, {
    pageNumber: 1,
    hasPrevious: false,
    hasNext: false,
    loading: false,
  });
  element(`${prefix}-page`).textContent = "";
}

function clearEvents(message = "Select a run to view its events.") {
  eventsPager = null;
  selectedRunId = null;
  clearTracePane(ui.eventsList, ui.eventsState, ui.eventsPage, message);
  emptyNavigation("events");
  ui.eventsHelp.textContent =
    "Select a run to inspect selection evidence and verification results in order.";
}

function clearRuns(message = "Select a project to view its runs.") {
  runsPager = null;
  runs = [];
  selectedProject = null;
  clearTracePane(ui.runsList, ui.runsState, ui.runsPage, message);
  emptyNavigation("runs");
  ui.runsHelp.textContent = "Select a project to view its runs.";
  clearEvents();
  graph.clear();
}

function disconnect(message = "Disconnected.", error = false) {
  bearerToken = "";
  projectsPager = null;
  projects = [];
  ui.token.value = "";
  ui.workspace.hidden = true;
  ui.disconnect.hidden = true;
  ui.projectsList.replaceChildren();
  clearRuns();
  connectionMessage(message, error);
}

function messageFor(error) {
  if (error instanceof TraceApiError) return error.message;
  return "Could not refresh the trace view.";
}

function handleRequestError(stateElement, error) {
  if (error instanceof TraceApiError && error.status === 401) {
    disconnect("The token is invalid or has expired. Connect again.", true);
    return;
  }
  setPaneState(stateElement, messageFor(error), true);
}

const graph = createKnowledgeGraphController({
  api,
  pageLimit: PAGE_LIMIT,
  readProject: () => selectedProject,
  onError: handleRequestError,
  emptyNavigation,
  ui: {
    viewport: ui.graphViewport,
    state: ui.graphState,
    help: ui.graphHelp,
  },
});

function applyProjectPage(result) {
  projects = Array.isArray(result.page.projects) ? result.page.projects : [];
  clearRuns();
  renderProjects(ui.projectsList, projects, selectedProject, selectProject);
  setPagination("projects", result.navigation);
  setPaneState(
    ui.projectsState,
    projects.length === 0 ? "This page has no projects to inspect." : `${projects.length} projects`,
  );
}

async function navigateProjects(direction) {
  if (projectsPager === null) return;
  const pager = projectsPager;
  await moveCursorPage(
    {
      pager,
      prefix: "projects",
      stateElement: ui.projectsState,
      loadingMessage: "Loading projects.",
      isCurrent: () => projectsPager === pager,
      apply: applyProjectPage,
      onError: (error) => handleRequestError(ui.projectsState, error),
    },
    direction,
  );
}

function applyRunPage(pager, result) {
  if (runsPager !== pager) return;
  runs = Array.isArray(result.page.runs) ? result.page.runs : [];
  selectedRunId = null;
  clearEvents();
  renderRuns(ui.runsList, runs, selectedRunId, selectRun);
  setPagination("runs", result.navigation);
  setPaneState(
    ui.runsState,
    runs.length === 0 ? "This page has no run records." : `${runs.length} runs`,
  );
}

async function selectProject(project) {
  selectedProject = project;
  selectedRunId = null;
  runs = [];
  ui.runsList.replaceChildren();
  emptyNavigation("runs");
  renderProjects(ui.projectsList, projects, selectedProject, selectProject);
  clearEvents();
  ui.runsHelp.textContent = `Runs for ${project.projectName}, ordered by time.`;
  void graph.selectFocus({ kind: "project", id: project.projectId });
  const pager = createCursorPager((cursor) => api.getProject(project, cursor, PAGE_LIMIT));
  runsPager = pager;
  await loadFirstPage({
    pager,
    prefix: "runs",
    stateElement: ui.runsState,
    loadingMessage: "Loading runs.",
    isCurrent: () => runsPager === pager,
    apply: (result) => applyRunPage(pager, result),
    onError: (error) => handleRequestError(ui.runsState, error),
  });
}

async function navigateRuns(direction) {
  if (runsPager === null) return;
  const pager = runsPager;
  await moveCursorPage(
    {
      pager,
      prefix: "runs",
      stateElement: ui.runsState,
      loadingMessage: "Loading runs.",
      isCurrent: () => runsPager === pager,
      apply: (result) => applyRunPage(pager, result),
      onError: (error) => handleRequestError(ui.runsState, error),
    },
    direction,
  );
}

function applyEventPage(pager, result) {
  if (eventsPager !== pager) return;
  const events = Array.isArray(result.page.events) ? result.page.events : [];
  renderEvents(ui.eventsList, events);
  setPagination("events", result.navigation);
  setPaneState(
    ui.eventsState,
    events.length === 0 ? "This page has no events." : `${events.length} events`,
  );
}

async function selectRun(run) {
  if (selectedProject === null) return;
  selectedRunId = run.runId;
  ui.eventsList.replaceChildren();
  emptyNavigation("events");
  renderRuns(ui.runsList, runs, selectedRunId, selectRun);
  ui.eventsHelp.textContent = `Events for ${run.runId}, shown in project order.`;
  void graph.selectFocus({ kind: "run", id: run.runId });
  const project = selectedProject;
  const pager = createCursorPager((cursor) => api.getRun(project, run.runId, cursor, PAGE_LIMIT));
  eventsPager = pager;
  await loadFirstPage({
    pager,
    prefix: "events",
    stateElement: ui.eventsState,
    loadingMessage: "Loading events.",
    isCurrent: () => eventsPager === pager,
    apply: (result) => applyEventPage(pager, result),
    onError: (error) => handleRequestError(ui.eventsState, error),
  });
}

async function navigateEvents(direction) {
  if (eventsPager === null) return;
  const pager = eventsPager;
  await moveCursorPage(
    {
      pager,
      prefix: "events",
      stateElement: ui.eventsState,
      loadingMessage: "Loading events.",
      isCurrent: () => eventsPager === pager,
      apply: (result) => applyEventPage(pager, result),
      onError: (error) => handleRequestError(ui.eventsState, error),
    },
    direction,
  );
}

ui.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = ui.token.value;
  ui.token.value = "";
  bearerToken = candidate;
  ui.workspace.hidden = true;
  ui.disconnect.hidden = true;
  projects = [];
  ui.projectsList.replaceChildren();
  clearRuns();
  connectionMessage("Checking access.");
  const pager = createCursorPager((cursor) => api.listProjects(cursor, PAGE_LIMIT));
  projectsPager = pager;
  try {
    const result = await pager.firstPage();
    if (projectsPager !== pager || result === null) return;
    ui.workspace.hidden = false;
    ui.disconnect.hidden = false;
    connectionMessage("Connected. Select a project to inspect.");
    applyProjectPage(result);
  } catch (error) {
    if (projectsPager !== pager) return;
    bearerToken = "";
    projectsPager = null;
    connectionMessage(messageFor(error), true);
  }
});

ui.disconnect.addEventListener("click", () => disconnect());
ui.projectsPrevious.addEventListener("click", () => void navigateProjects("previous"));
ui.projectsNext.addEventListener("click", () => void navigateProjects("next"));
ui.runsPrevious.addEventListener("click", () => void navigateRuns("previous"));
ui.runsNext.addEventListener("click", () => void navigateRuns("next"));
ui.eventsPrevious.addEventListener("click", () => void navigateEvents("previous"));
ui.eventsNext.addEventListener("click", () => void navigateEvents("next"));
ui.graphPrevious.addEventListener("click", () => void graph.navigate("previous"));
ui.graphNext.addEventListener("click", () => void graph.navigate("next"));
window.addEventListener("pagehide", () => {
  bearerToken = "";
  ui.token.value = "";
});

emptyNavigation("projects");
emptyNavigation("runs");
emptyNavigation("events");
graph.clear();
