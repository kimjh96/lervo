import { useSyncExternalStore } from "react";

import { useHostReplacement } from "../../../ports";
import { hostIsCurrent } from "./update";

/** Whether the session host the last connection reached knows every request of this interface. */
export function useHostIsCurrent(): boolean {
  const replacement = useHostReplacement();
  const identity = useSyncExternalStore(
    (changed) => replacement.onIdentity(changed),
    () => replacement.identity,
  );
  return hostIsCurrent(identity);
}
