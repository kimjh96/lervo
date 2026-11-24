import { failureCode, type HostIdentity, type HostReplacement } from "../../../ports";
import { type HostUpdate, useConnectionStore } from "./store";

/** Whether `version` is older than `than` by `major.minor.patch`; an unreadable one is not. */
export function olderVersion(version: string, than: string): boolean {
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)/u.exec(value)?.slice(1, 4).map(Number);
  const [left, right] = [parse(version), parse(than)];
  if (left === undefined || right === undefined) return false;
  const differs = left.findIndex((part, index) => part !== right[index]);
  return differs !== -1 && (left[differs] ?? 0) < (right[differs] ?? 0);
}

/** The update a session host with `identity` offers. */
export function updateFor(identity: HostIdentity): HostUpdate {
  return identity.replaceable && olderVersion(identity.hostVersion, identity.appVersion)
    ? { kind: "available" }
    : { kind: "none" };
}

/**
 * Offers to replace a session host older than the application, on each connection. Nothing is
 * replaced without the user: the session host's sessions end with it, and the interface cannot
 * tell when it has heard every running session's status. Returns the unsubscribe function.
 */
export function bindHostUpdate(replacement: HostReplacement): () => void {
  const apply = (identity: HostIdentity) =>
    useConnectionStore.setState({ update: updateFor(identity) });
  if (replacement.identity !== null) apply(replacement.identity);
  return replacement.onIdentity(apply);
}

/**
 * Ends the older session host. The connection then ends, and the next one starts the shell's own
 * session host, whose identity clears the offer.
 */
export async function restartHost(replacement: HostReplacement): Promise<void> {
  useConnectionStore.setState({ update: { kind: "restarting" } });
  try {
    await replacement.replace();
  } catch (failure) {
    useConnectionStore.setState({ update: { kind: "failed", code: failureCode(failure) } });
  }
}
