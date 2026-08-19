import {
  type HubProjectCoordinate,
  type HubSyncReadView,
} from "@lervo/hub-sync";

import { HubTraceError } from "./errors.js";
import { projectTrace, projectTraceSummary, runTrace } from "./projection.js";
import {
  type HubProjectTrace,
  type HubProjectTraceSummary,
  type HubRunTrace,
} from "./types.js";

export interface HubTraceSource {
  read<T>(work: (view: HubSyncReadView) => T): T;
}

function requiredProject(view: HubSyncReadView, coordinate: HubProjectCoordinate) {
  const state = view.loadProject(coordinate);
  if (state === null) {
    throw new HubTraceError("project_not_found", "요청한 Hub project trace가 없습니다.");
  }
  return state;
}

export class HubTraceReader {
  constructor(private readonly source: HubTraceSource) {}

  listProjects(): HubProjectTraceSummary[] {
    return this.source.read((view) =>
      view.listProjectCoordinates().sort((left, right) =>
        left.destinationId.localeCompare(right.destinationId) ||
        left.projectId.localeCompare(right.projectId)
      ).map((coordinate) => {
        const state = view.loadProject(coordinate);
        if (state === null) {
          throw new HubTraceError(
            "source_inconsistent",
            "Hub project index와 trace 원본이 같은 snapshot에 없습니다.",
          );
        }
        return projectTraceSummary(state);
      })
    );
  }

  getProject(coordinate: HubProjectCoordinate): HubProjectTrace {
    return this.source.read((view) => projectTrace(requiredProject(view, coordinate)));
  }

  getRun(input: HubProjectCoordinate & { runId: string }): HubRunTrace {
    return this.source.read((view) => runTrace(requiredProject(view, input), input.runId));
  }
}
