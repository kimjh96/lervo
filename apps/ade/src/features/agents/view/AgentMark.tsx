import type { AgentSummary } from "@lervo/session-host-contract";

import { Mark } from "../../../ui/Mark";
import { useMarkThumbnail } from "../../projects";

/**
 * An agent's mark: the image the owner chose, from the thumbnail the ADE keeps by its hash, or
 * the agent's first letter until it is kept or when it has none.
 */
export function AgentMark(props: {
  agent: Pick<AgentSummary, "agentId" | "displayName" | "mark">;
  size: "sm" | "md" | "lg";
}) {
  const src = useMarkThumbnail(props.agent.mark?.sha256 ?? undefined);
  return (
    <Mark
      id={props.agent.agentId}
      name={props.agent.displayName}
      src={src}
      size={props.size}
      shape="round"
    />
  );
}
