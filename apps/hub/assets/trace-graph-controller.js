import { renderKnowledgeGraph } from "/assets/trace-graph.js";
import { loadFirstPage, moveCursorPage } from "/assets/trace-navigation.js";
import { createCursorPager } from "/assets/trace-pagination.js";
import { setPagination, setPaneState } from "/assets/trace-render.js";

const EMPTY_MESSAGE = "프로젝트를 선택하면 명시적으로 기록된 관계를 확인할 수 있습니다.";

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
      relations.length === 0 ? "이 항목에 연결된 관계가 없습니다." : `${relations.length}개 관계`,
    );
    options.ui.help.textContent = `${focus.kind} · ${focus.id}에서 한 단계로 연결된 관계입니다.`;
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
      loadingMessage: "명시적 관계를 불러오는 중입니다.",
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
      loadingMessage: "명시적 관계를 불러오는 중입니다.",
      isCurrent: () => pager === currentPager,
      apply: (result) => applyPage(currentPager, result),
      onError: (error) => options.onError(options.ui.state, error),
    }, direction);
  }

  return { clear, navigate, selectFocus };
}
