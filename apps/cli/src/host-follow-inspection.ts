import { errorCode } from "./command-error-output.js";
import { chooseFollowTarget, repositoryPassDue } from "./host-follow-policy.js";
import { readActiveCli } from "./host-follow-runtime.js";
import {
  inspectFollowServiceDefinition,
  readFollowServiceStatus,
  type FollowServiceDefinition,
  type HostFollowServicePorts,
} from "./host-follow-service.js";
import {
  readFollowControl,
  readFollowState,
  type HostFollowControl,
  type HostFollowState,
} from "./host-follow-state.js";
import type { HostReleaseSource } from "./host-release-source.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";
import type { ManagedServiceStatus } from "./managed-user-service-write.js";

export type HostFollowNextStep =
  | "host_blocked"
  | "handover"
  | "paused"
  | "repository_pass"
  | "source_unavailable"
  | "install"
  | "current"
  | "no_published_release"
  | "release_failed_on_host"
  | "pinned_release_unavailable"
  | "pinned_release_reached";

export interface HostFollowInspection {
  repository: string;
  activeVersion: string | null;
  activeTarget: string | null;
  control: HostFollowControl;
  state: HostFollowState;
  next: HostFollowNextStep;
  tag: string | null;
  code: string | null;
}

/**
 * ADR-0575, read-only: what the next follow cycle would do on this host. It reads the release
 * list, the links, and the follower files, and writes nothing.
 */
export async function inspectFollowCycle(input: {
  layout: HostUpgradeLayout;
  source: HostReleaseSource;
  runningInstallRoot: () => Promise<string | null>;
}): Promise<HostFollowInspection> {
  const [state, control] = await Promise.all([
    readFollowState(input.layout),
    readFollowControl(input.layout),
  ]);
  const base = { repository: input.source.repository, control, state, tag: null, code: null };
  let active;
  try {
    active = await readActiveCli(input.layout);
  } catch (error) {
    return {
      ...base,
      activeVersion: null,
      activeTarget: null,
      next: "host_blocked",
      code: errorCode(error),
    };
  }
  const known = { ...base, activeVersion: active.version, activeTarget: active.target };
  const running = await input.runningInstallRoot();
  if (active.packageRoot !== null && running !== null && running !== active.packageRoot)
    return { ...known, next: "handover" };
  if (control.paused) return { ...known, next: "paused" };
  if (repositoryPassDue(state, active)) return { ...known, next: "repository_pass" };
  let releases;
  try {
    releases = await input.source.listReleases();
  } catch (error) {
    return { ...known, next: "source_unavailable", code: errorCode(error) };
  }
  const target = chooseFollowTarget({
    releases,
    activeVersion: active.version,
    failedTags: state.failedTags.map((entry) => entry.tag),
    pinnedTag: control.pinnedTag,
  });
  return target.kind === "install"
    ? { ...known, next: "install", tag: target.tag }
    : { ...known, next: target.reason, tag: target.tag };
}

export interface HostFollowStatus {
  state: HostFollowState;
  control: HostFollowControl;
  activeVersion: string | null;
  service: ManagedServiceStatus | null;
  serviceDefinition: FollowServiceDefinition;
}

/** Read-only: the follower files, the active CLI, and the service manager's view. */
export async function readFollowStatus(
  layout: HostUpgradeLayout,
  ports: HostFollowServicePorts,
): Promise<HostFollowStatus> {
  const [state, control, active, service, serviceDefinition] = await Promise.all([
    readFollowState(layout),
    readFollowControl(layout),
    readActiveCli(layout).catch(() => null),
    readFollowServiceStatus(ports),
    inspectFollowServiceDefinition(layout, ports),
  ]);
  return { state, control, activeVersion: active?.version ?? null, service, serviceDefinition };
}
