import { renderKnowledgeGraph } from "/assets/trace-graph.js";
import { loadFirstPage, moveCursorPage } from "/assets/trace-navigation.js";
import { createCursorPager } from "/assets/trace-pagination.js";
import { setPagination, setPaneState } from "/assets/trace-render.js";

const EMPTY_MESSAGE = "Select a project to inspect explicitly recorded relationships.";

export function createKnowledgeGraphController(options) {
  let pager = null;

  function clear(message = EMPTY_MESSAGE) {
    pager = null;
    options.ui.viewport.replaceChildren();
    setPaneState(options.ui.state, message);
    options.emptyNavigation("graph");
    options.ui.help.textContent = EMPTY_MESSAGE;
  }

  function applyPage(currentPager, result) {
    if (pager !== currentPager) return;
    const relations = Array.isArray(result.page.relations) ? result.page.relations : [];
    const focus = result.page.focus;
    renderKnowledgeGraph(options.ui.viewport, focus, relations, (node) => void selectFocus(node));
    setPagination("graph", result.navigation);
    setPaneState(
      options.ui.state,
      relations.length === 0 ? "This item has no connected relationships." : `${relations.length} relationships`,
    );
    options.ui.help.textContent = `Relationships one step away from ${focus.kind} · ${focus.id}.`;
  }

  async function selectFocus(focus) {
    const project = options.readProject();
    if (project === null) return;
    const targetFocus = { kind: focus.kind, id: focus.id };
    options.ui.viewport.replaceChildren();
    options.emptyNavigation("graph");
    const currentPager = createCursorPager((cursor) =>
      options.api.getKnowledgeGraph(project, targetFocus, cursor, options.pageLimit));
    pager = currentPager;
    await loadFirstPage({
      pager: currentPager,
      prefix: "graph",
      stateElement: options.ui.state,
      loadingMessage: "Loading explicit relationships.",
      isCurrent: () => pager === currentPager,
      apply: (result) => applyPage(currentPager, result),
      onError: (error) => options.onError(options.ui.state, error),
    });
  }

  async function navigate(direction) {
    if (pager === null) return;
    const currentPager = pager;
    await moveCursorPage({
      pager: currentPager,
      prefix: "graph",
      stateElement: options.ui.state,
      loadingMessage: "Loading explicit relationships.",
      isCurrent: () => pager === currentPager,
      apply: (result) => applyPage(currentPager, result),
      onError: (error) => options.onError(options.ui.state, error),
    }, direction);
  }

  return { clear, navigate, selectFocus };
}
