import { SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES } from "@lervo/search";

interface SearchProjectionWorkstream {
  workstreamId: string;
  revision: number;
  objective: string;
  nextActions: string[];
  references: Array<{ path: string }>;
}

export function createCurrentWorkstreamSearchProjectionContext(
  workstream: SearchProjectionWorkstream,
): {
  context: {
    currentWorkstream: {
      workstreamId: string;
      revision: number;
      objective: string;
      nextActions: string[];
      references: string[];
    };
    contextAnchors: string[];
  };
  contextAnchors: string[];
} {
  const contextAnchors = [
    ...new Set(workstream.references.map((reference) => reference.path)),
  ].slice(0, SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES);
  return {
    context: {
      currentWorkstream: {
        workstreamId: workstream.workstreamId,
        revision: workstream.revision,
        objective: workstream.objective,
        nextActions: workstream.nextActions,
        references: contextAnchors,
      },
      contextAnchors,
    },
    contextAnchors,
  };
}
