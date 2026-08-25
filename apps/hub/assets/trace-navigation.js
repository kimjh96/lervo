import { setPagination, setPaneState } from "/assets/trace-render.js";

async function perform(options, operation) {
  setPaneState(options.stateElement, options.loadingMessage);
  setPagination(options.prefix, options.pager.navigation());
  try {
    const result = await operation;
    if (options.isCurrent() && result !== null) options.apply(result);
  } catch (error) {
    if (!options.isCurrent()) return;
    setPagination(options.prefix, options.pager.navigation());
    options.onError(error);
  }
}

export function loadFirstPage(options) {
  return perform(options, options.pager.firstPage());
}

export function moveCursorPage(options, direction) {
  const operation = direction === "next" ? options.pager.nextPage() : options.pager.previousPage();
  return perform(options, operation);
}
