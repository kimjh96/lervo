/** The part of the document the visibility binding reads and marks. */
export type VisibilityPage = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
> & { readonly documentElement: { readonly dataset: DOMStringMap } };

/**
 * Marks the document while the window is hidden, minimized, or occluded, so stylesheets pause
 * every animation then (ADE performance, "Work only for what the user sees"). WebKit reports
 * occlusion of the window through the page's visibility. Returns the unbind function.
 */
export function bindVisibility(page: VisibilityPage = document): () => void {
  const { dataset } = page.documentElement;
  const update = () => {
    if (page.visibilityState === "hidden") dataset.visibility = "hidden";
    else delete dataset.visibility;
  };
  update();
  page.addEventListener("visibilitychange", update);
  return () => {
    page.removeEventListener("visibilitychange", update);
    delete dataset.visibility;
  };
}
