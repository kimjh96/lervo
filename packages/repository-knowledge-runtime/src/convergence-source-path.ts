/** Paths eligible for semantic sources and delegated source roots exclude private metadata. */
export function safeConvergenceSourcePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 500 &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.includes("\0") &&
    !path.split("/").some((part) => !part || part === "." || part === "..") &&
    !path.startsWith(".lervo/state") &&
    !path.startsWith(".lervo/data") &&
    !path.startsWith(".lervo/run") &&
    path !== ".lervo" &&
    !path.startsWith(".lervo/knowledge")
  );
}
