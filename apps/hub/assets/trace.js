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
  if (value === null) throw new Error(`필수 화면 요소가 없습니다: ${id}`);
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

function clearEvents(message = "실행을 선택하면 이벤트를 확인할 수 있습니다.") {
  eventsPager = null;
  selectedRunId = null;
  clearTracePane(ui.eventsList, ui.eventsState, ui.eventsPage, message);
  emptyNavigation("events");
  ui.eventsHelp.textContent = "실행을 선택하면 선택 근거와 검증 결과를 순서대로 확인할 수 있습니다.";
}

function clearRuns(message = "프로젝트를 선택하면 실행 목록을 확인할 수 있습니다.") {
  runsPager = null;
  runs = [];
  selectedProject = null;
  clearTracePane(ui.runsList, ui.runsState, ui.runsPage, message);
  emptyNavigation("runs");
  ui.runsHelp.textContent = "프로젝트를 선택하면 실행 목록을 확인할 수 있습니다.";
  clearEvents();
  graph.clear();
}

function disconnect(message = "연결을 해제했습니다.", error = false) {
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
  return "Trace 화면을 갱신하지 못했습니다.";
}

function handleRequestError(stateElement, error) {
  if (error instanceof TraceApiError && error.status === 401) {
    disconnect("토큰이 만료되었거나 올바르지 않습니다. 다시 연결해 주세요.", true);
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
    projects.length === 0 ? "이 페이지에는 조회할 프로젝트가 없습니다." : `${projects.length}개 프로젝트`,
  );
}

async function navigateProjects(direction) {
  if (projectsPager === null) return;
  const pager = projectsPager;
  await moveCursorPage({
    pager,
    prefix: "projects",
    stateElement: ui.projectsState,
    loadingMessage: "프로젝트를 불러오는 중입니다.",
    isCurrent: () => projectsPager === pager,
    apply: applyProjectPage,
    onError: (error) => handleRequestError(ui.projectsState, error),
  }, direction);
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
    runs.length === 0 ? "이 페이지에는 실행 기록이 없습니다." : `${runs.length}개 실행`,
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
  ui.runsHelp.textContent = `${project.projectName}의 실행을 시간순으로 표시합니다.`;
  void graph.selectFocus({ kind: "project", id: project.projectId });
  const pager = createCursorPager((cursor) => api.getProject(project, cursor, PAGE_LIMIT));
  runsPager = pager;
  await loadFirstPage({
    pager,
    prefix: "runs",
    stateElement: ui.runsState,
    loadingMessage: "실행 목록을 불러오는 중입니다.",
    isCurrent: () => runsPager === pager,
    apply: (result) => applyRunPage(pager, result),
    onError: (error) => handleRequestError(ui.runsState, error),
  });
}

async function navigateRuns(direction) {
  if (runsPager === null) return;
  const pager = runsPager;
  await moveCursorPage({
    pager,
    prefix: "runs",
    stateElement: ui.runsState,
    loadingMessage: "실행 목록을 불러오는 중입니다.",
    isCurrent: () => runsPager === pager,
    apply: (result) => applyRunPage(pager, result),
    onError: (error) => handleRequestError(ui.runsState, error),
  }, direction);
}

function applyEventPage(pager, result) {
  if (eventsPager !== pager) return;
  const events = Array.isArray(result.page.events) ? result.page.events : [];
  renderEvents(ui.eventsList, events);
  setPagination("events", result.navigation);
  setPaneState(
    ui.eventsState,
    events.length === 0 ? "이 페이지에는 이벤트가 없습니다." : `${events.length}개 이벤트`,
  );
}

async function selectRun(run) {
  if (selectedProject === null) return;
  selectedRunId = run.runId;
  ui.eventsList.replaceChildren();
  emptyNavigation("events");
  renderRuns(ui.runsList, runs, selectedRunId, selectRun);
  ui.eventsHelp.textContent = `${run.runId}의 이벤트를 project 순서대로 표시합니다.`;
  void graph.selectFocus({ kind: "run", id: run.runId });
  const project = selectedProject;
  const pager = createCursorPager((cursor) => api.getRun(project, run.runId, cursor, PAGE_LIMIT));
  eventsPager = pager;
  await loadFirstPage({
    pager,
    prefix: "events",
    stateElement: ui.eventsState,
    loadingMessage: "이벤트를 불러오는 중입니다.",
    isCurrent: () => eventsPager === pager,
    apply: (result) => applyEventPage(pager, result),
    onError: (error) => handleRequestError(ui.eventsState, error),
  });
}

async function navigateEvents(direction) {
  if (eventsPager === null) return;
  const pager = eventsPager;
  await moveCursorPage({
    pager,
    prefix: "events",
    stateElement: ui.eventsState,
    loadingMessage: "이벤트를 불러오는 중입니다.",
    isCurrent: () => eventsPager === pager,
    apply: (result) => applyEventPage(pager, result),
    onError: (error) => handleRequestError(ui.eventsState, error),
  }, direction);
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
  connectionMessage("권한을 확인하는 중입니다.");
  const pager = createCursorPager((cursor) => api.listProjects(cursor, PAGE_LIMIT));
  projectsPager = pager;
  try {
    const result = await pager.firstPage();
    if (projectsPager !== pager || result === null) return;
    ui.workspace.hidden = false;
    ui.disconnect.hidden = false;
    connectionMessage("연결되었습니다. 조회할 프로젝트를 선택하세요.");
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
